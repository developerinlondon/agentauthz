// The enforcement seam: every "may these subjects do this action on this
// resource?" question goes through Authz.check — no call site reads grant
// storage directly. The engine composes the host's ports (grant store, role
// synthesizers, audit sink) around the pure statement engine in
// core/evaluate.ts; an alternative backend implements GrantSource and the
// config flips with zero call-site churn.

import type { ConditionKeys } from "../model/condition.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { ResolvedGrant } from "../model/grant.js";
import { isValidScope, type Scope, type ScopeChain } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import { isValidSubject } from "../model/subject.js";
import type {
  ActionRegistry,
  AuditSink,
  GrantStore,
  ScopeRoleSynthesizer,
} from "../ports/index.js";
import { builtinContextEntries, makeConditionContext, resolveConditionKeys } from "./conditions.js";
import { describeAuthz } from "./describe.js";
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

// Provenance of an allow decision (checkDetailed): the same deny-wins verdict
// as check(), plus whether the STORED grants alone would allow it — i.e.
// whether an explicit grant, not a synthesizer (open-mode baseline, participant
// roles, …), carried the allow. Lets a host distinguish "allowed because this
// principal was explicitly granted" from "allowed only by an ambient default".
export interface CheckDetail {
  // The final deny-wins decision (bypass ⇒ "admin_bypass").
  decision: "allow" | "deny" | "admin_bypass";
  // The overall verdict as a boolean (decision !== "deny").
  allowed: boolean;
  // Would the STORED grants alone (synthesizers excluded) allow this? A stored
  // deny — or nothing stored — makes this false even when a synthesizer allows.
  // admin_bypass does not fabricate a stored grant, so this stays as the real
  // stored-grant verdict.
  allowedByStoredGrants: boolean;
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
  // check() plus allow-provenance: whether the stored grants alone (no
  // synthesizers) allow it. Audited identically to check(). Bypass returns
  // decision "admin_bypass"/allowed true but reports the real stored verdict.
  checkDetailed(
    subjects: readonly Subject[],
    action: string,
    resource: string,
    opts?: CheckOpts,
  ): Promise<CheckDetail>;
  // The grants effective for these subjects over a chain, for a "why" view.
  // Bypass is not materialised here — it's a check()-time rule.
  listGrantsFor(subjects: readonly Subject[], scopeChain?: ScopeChain): Promise<ResolvedGrant[]>;
  // This engine's declared vocabulary as data, for an administration surface.
  describe(): AuthzDescriptor;
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
  // When the host's registry declares derivation, a statement naming a base
  // action covers everything deriving from it — allow and deny alike.
  actionRegistry?: ActionRegistry;
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
    const allowed =
      decide(grants, action, resource, ctx, this.keys, this.options.actionRegistry?.parentOf)
        === "allow";
    this.audit(subjects, action, resource, allowed ? "allow" : "deny", opts);
    return allowed;
  }

  async checkDetailed(
    subjects: readonly Subject[],
    action: string,
    resource: string,
    opts?: CheckOpts,
  ): Promise<CheckDetail> {
    const chain = opts?.scopeChain ?? this.options.defaultScopeChain ?? [];
    const badChain = !Array.isArray(chain) || chain.some((s) => !this.knownScope(s));
    if (badChain) {
      // Fail closed exactly like check(): an unknown chain denies, and stored
      // grants are never consulted, so there is no explicit allow to report.
      if (!opts?.bypass) this.audit(subjects, action, resource, "deny", opts);
      else this.audit(subjects, action, resource, "admin_bypass", opts);
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
    const storedAllows =
      decide(stored, action, resource, ctx, this.keys, this.options.actionRegistry?.parentOf)
        === "allow";
    const fullAllows = decide(
      [...stored, ...synthesized],
      action,
      resource,
      ctx,
      this.keys,
      this.options.actionRegistry?.parentOf,
    ) === "allow";
    const decision = opts?.bypass ? "admin_bypass" : fullAllows ? "allow" : "deny";
    this.audit(subjects, action, resource, decision, opts);
    return {
      decision,
      allowed: decision !== "deny",
      allowedByStoredGrants: storedAllows,
    };
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

  describe(): AuthzDescriptor {
    return describeAuthz({
      actionRegistry: this.options.actionRegistry,
      conditionKeys: this.options.conditionKeys,
      scopeKinds: this.options.scopeKinds,
    });
  }

  private knownScope(scope: unknown): boolean {
    if (!isValidScope(scope)) return false;
    return !this.options.scopeKinds || this.options.scopeKinds.includes((scope as Scope).kind);
  }

  private async resolveGrants(
    subjects: readonly Subject[],
    chain: ScopeChain,
  ): Promise<ResolvedGrant[]> {
    const { stored, synthesized } = await this.resolveGrantsSplit(subjects, chain);
    return [...stored, ...synthesized];
  }

  // Stored grants and synthesizer output kept apart, so checkDetailed can decide
  // "would the stored grants alone allow this?" independently of the ambient
  // synthesizers (open-mode baseline, participant roles).
  private async resolveGrantsSplit(
    subjects: readonly Subject[],
    chain: ScopeChain,
  ): Promise<{ stored: ResolvedGrant[]; synthesized: ResolvedGrant[]; }> {
    const stored = await this.options.grantStore.grantsFor(subjects, chain);
    const synthesized = await Promise.all(
      (this.options.synthesizers ?? []).map((s) => s.grantsFor(subjects, chain)),
    );
    return { stored, synthesized: synthesized.flat() };
  }
}

export function makeAuthz(options: AuthzOptions): Authz {
  return new AuthzEvaluator(options);
}
