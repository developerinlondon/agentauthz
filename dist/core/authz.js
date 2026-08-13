// The enforcement seam: every "may these subjects do this action on this
// resource?" question goes through Authz.check — no call site reads grant
// storage directly. The engine composes the host's ports (grant store, role
// synthesizers, audit sink) around the pure statement engine in
// core/evaluate.ts; an alternative backend implements GrantSource and the
// config flips with zero call-site churn.
import { isValidScope } from "../model/scope.js";
import { isValidSubject } from "../model/subject.js";
import { builtinContextEntries, makeConditionContext, resolveConditionKeys } from "./conditions.js";
import { describeAuthz } from "./describe.js";
import { decide } from "./evaluate.js";
class AuthzEvaluator {
    options;
    keys;
    constructor(options) {
        this.options = options;
        this.keys = resolveConditionKeys(options.conditionKeys);
    }
    audit(subjects, action, resource, decision, opts) {
        if (opts?.silent)
            return;
        this.options.auditSink?.record({
            subjects,
            action,
            resource,
            decision,
            source: opts?.source ?? "api",
            detail: opts?.auditDetail ?? null,
        });
    }
    async check(subjects, action, resource, opts) {
        if (opts?.bypass) {
            this.audit(subjects, action, resource, "admin_bypass", opts);
            return true;
        }
        // Fail closed on a chain the hierarchy doesn't know: an unrecognized or
        // malformed scope must never widen to "evaluate the default chain
        // instead" — deny outright.
        const chain = opts?.scopeChain ?? this.options.defaultScopeChain ?? [];
        if (!Array.isArray(chain) || chain.some((s) => !this.knownScope(s))) {
            this.audit(subjects, action, resource, "deny", opts);
            return false;
        }
        const valid = Array.isArray(subjects) ? subjects.filter(isValidSubject) : [];
        const grants = await this.resolveGrants(valid, chain);
        // The condition context is built here, inside the seam, from the real
        // check inputs only — host-declared entries plus the built-in request:*
        // keys — never from caller-supplied attribute bags.
        const ctx = makeConditionContext({
            ...opts?.context,
            ...builtinContextEntries({ now: opts?.now, sourceIp: opts?.sourceIp }),
        });
        // Deny wins across the whole resolved scope chain — a deny granted at any
        // scope beats an allow inherited from any other; an explicit deny and
        // "nothing matched" both audit as `deny`.
        const allowed = decide(grants, action, resource, ctx, this.keys, this.options.actionRegistry?.parentOf)
            === "allow";
        this.audit(subjects, action, resource, allowed ? "allow" : "deny", opts);
        return allowed;
    }
    async checkDetailed(subjects, action, resource, opts) {
        const chain = opts?.scopeChain ?? this.options.defaultScopeChain ?? [];
        const badChain = !Array.isArray(chain) || chain.some((s) => !this.knownScope(s));
        if (badChain) {
            // Fail closed exactly like check(): an unknown chain denies, and stored
            // grants are never consulted, so there is no explicit allow to report.
            if (!opts?.bypass)
                this.audit(subjects, action, resource, "deny", opts);
            else
                this.audit(subjects, action, resource, "admin_bypass", opts);
            return {
                decision: opts?.bypass ? "admin_bypass" : "deny",
                allowed: !!opts?.bypass,
                allowedByStoredGrants: false,
            };
        }
        const valid = Array.isArray(subjects) ? subjects.filter(isValidSubject) : [];
        const { stored, synthesized } = await this.resolveGrantsSplit(valid, chain);
        const ctx = makeConditionContext({
            ...opts?.context,
            ...builtinContextEntries({ now: opts?.now, sourceIp: opts?.sourceIp }),
        });
        const storedAllows = decide(stored, action, resource, ctx, this.keys, this.options.actionRegistry?.parentOf)
            === "allow";
        const fullAllows = decide([...stored, ...synthesized], action, resource, ctx, this.keys, this.options.actionRegistry?.parentOf) === "allow";
        const decision = opts?.bypass ? "admin_bypass" : fullAllows ? "allow" : "deny";
        this.audit(subjects, action, resource, decision, opts);
        return {
            decision,
            allowed: decision !== "deny",
            allowedByStoredGrants: storedAllows,
        };
    }
    async listGrantsFor(subjects, scopeChain) {
        // The same fail-closed chain validation as check(): a malformed or
        // undeclared entry yields nothing rather than reaching the store with a
        // chain the caller never validly named.
        const chain = scopeChain ?? this.options.defaultScopeChain ?? [];
        if (!Array.isArray(chain) || chain.some((s) => !this.knownScope(s)))
            return [];
        const valid = Array.isArray(subjects) ? subjects.filter(isValidSubject) : [];
        return await this.resolveGrants(valid, chain);
    }
    describe() {
        return describeAuthz({
            actionRegistry: this.options.actionRegistry,
            conditionKeys: this.options.conditionKeys,
            scopeKinds: this.options.scopeKinds,
        });
    }
    knownScope(scope) {
        if (!isValidScope(scope))
            return false;
        return !this.options.scopeKinds || this.options.scopeKinds.includes(scope.kind);
    }
    async resolveGrants(subjects, chain) {
        const { stored, synthesized } = await this.resolveGrantsSplit(subjects, chain);
        return [...stored, ...synthesized];
    }
    // Stored grants and synthesizer output kept apart, so checkDetailed can decide
    // "would the stored grants alone allow this?" independently of the ambient
    // synthesizers (open-mode baseline, participant roles).
    async resolveGrantsSplit(subjects, chain) {
        const stored = await this.options.grantStore.grantsFor(subjects, chain);
        const synthesized = await Promise.all((this.options.synthesizers ?? []).map((s) => s.grantsFor(subjects, chain)));
        return { stored, synthesized: synthesized.flat() };
    }
}
export function makeAuthz(options) {
    return new AuthzEvaluator(options);
}
//# sourceMappingURL=authz.js.map