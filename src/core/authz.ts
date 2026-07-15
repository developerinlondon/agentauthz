// The enforcement seam: every "may these subjects do this action on this
// resource?" question goes through Authz.check — no call site reads grant
// storage directly. The engine composes the host's ports (grant store, role
// synthesizers, audit sink) around the pure statement engine in
// core/evaluate.ts; an alternative backend implements GrantSource and the
// config flips with zero call-site churn.

import type { ConditionKeys } from "../model/condition.js";
import type { ResolvedGrant } from "../model/grant.js";
import { isValidScope, type Scope, type ScopeChain } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import { isValidSubject } from "../model/subject.js";
import type { AuditSink, GrantStore, ScopeRoleSynthesizer } from "../ports/index.js";
import { builtinContextEntries, makeConditionContext, resolveConditionKeys } from "./conditions.js";
import { decide } from "./evaluate.js";

export interface CheckOpts {
  // The door the check came through, for the audit log; defaults to "api".
  source?: string;
  // Skip the audit row: for read-only enumeration checks that would flood the
  // log without saying anything about intent. Mutating paths must never set
  // this.
  silent?: boolean;
  // Ordered host-resolved scope chain, root first. Omitted ⇒ the evaluator's
  // defaultScopeChain (typically just the host's root scope). A malformed
  // entry, or a kind outside the declared scopeKinds, DENIES (fail closed) —
  // it never silently evaluates a different chain than the caller named.
  scopeChain?: ScopeChain;
  // Host-populated values for its declared condition keys. Keys with no
  // honest value must be OMITTED (fail closed), never faked.
  context?: Record<string, string | number | string[]>;
  // The caller's IP, resolved by the host at its boundary — feeds the
  // built-in request:SourceIp key only; omitted/empty ⇒ that key stays
  // unpopulated for this check (fails closed).
  sourceIp?: string | null;
  // The host says this caller bypasses policy entirely (recovery: deny-wins
  // means a careless broad deny must never lock the operator out). Audited as
  // admin_bypass; no grant or condition is ever consulted.
  bypass?: boolean;
  // Extra forensic detail for the audit row (e.g. the scope the caller
  // named, verbatim — including a malformed one on a fail-closed deny).
  auditDetail?: Record<string, unknown> | null;
  // Evaluation instant override (tests); defaults to now.
  now?: Date;
}

export interface Authz {
  // May `subjects` perform `action` on `resource`? Union of the applicable
  // grants over the resolved scope chain; an explicit deny beats any allow;
  // nothing granted ⇒ false. Every evaluation is audited from inside the seam.
  check(
    subjects: readonly Subject[],
    action: string,
    resource: string,
    opts?: CheckOpts,
  ): Promise<boolean>;
  // The grants effective for these subjects over a chain, for a "why" view.
  // Bypass is not materialised here — it's a check()-time rule.
  listGrantsFor(subjects: readonly Subject[], scopeChain?: ScopeChain): Promise<ResolvedGrant[]>;
}

export interface AuthzOptions {
  grantStore: GrantStore;
  // Host-declared condition keys (built-in request:* keys are merged in).
  conditionKeys?: ConditionKeys;
  // Declared scope kinds; when given, a chain entry with any other kind
  // denies (fail closed).
  scopeKinds?: readonly string[];
  // The chain used when a check names none — typically [rootScope], so
  // unscoped checks see root grants only.
  defaultScopeChain?: ScopeChain;
  synthesizers?: readonly ScopeRoleSynthesizer[];
  auditSink?: AuditSink;
}

class AuthzEvaluator implements Authz {
  private readonly keys: ConditionKeys;

  constructor(private readonly options: AuthzOptions) {
    this.keys = resolveConditionKeys(options.conditionKeys);
  }

  private audit(
    subjects: readonly Subject[],
    action: string,
    resource: string,
    decision: "allow" | "deny" | "admin_bypass",
    opts: CheckOpts | undefined,
  ): void {
    if (opts?.silent) return;
    this.options.auditSink?.record({
      subjects,
      action,
      resource,
      decision,
      source: opts?.source ?? "api",
      detail: opts?.auditDetail ?? null,
    });
  }

  async check(
    subjects: readonly Subject[],
    action: string,
    resource: string,
    opts?: CheckOpts,
  ): Promise<boolean> {
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
    const allowed = decide(grants, action, resource, ctx, this.keys) === "allow";
    this.audit(subjects, action, resource, allowed ? "allow" : "deny", opts);
    return allowed;
  }

  async listGrantsFor(
    subjects: readonly Subject[],
    scopeChain?: ScopeChain,
  ): Promise<ResolvedGrant[]> {
    // The same fail-closed chain validation as check(): a malformed or
    // undeclared entry yields nothing rather than reaching the store with a
    // chain the caller never validly named.
    const chain = scopeChain ?? this.options.defaultScopeChain ?? [];
    if (!Array.isArray(chain) || chain.some((s) => !this.knownScope(s))) return [];
    const valid = Array.isArray(subjects) ? subjects.filter(isValidSubject) : [];
    return await this.resolveGrants(valid, chain);
  }

  private knownScope(scope: unknown): boolean {
    if (!isValidScope(scope)) return false;
    return !this.options.scopeKinds || this.options.scopeKinds.includes((scope as Scope).kind);
  }

  private async resolveGrants(
    subjects: readonly Subject[],
    chain: ScopeChain,
  ): Promise<ResolvedGrant[]> {
    const stored = await this.options.grantStore.grantsFor(subjects, chain);
    const synthesized = await Promise.all(
      (this.options.synthesizers ?? []).map((s) => s.grantsFor(subjects, chain)),
    );
    return [...stored, ...synthesized.flat()];
  }
}

export function makeAuthz(options: AuthzOptions): Authz {
  return new AuthzEvaluator(options);
}
