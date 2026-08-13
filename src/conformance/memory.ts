import { applicableGrants } from "../core/evaluate.js";
import type { GrantBounds, GrantRecord, ResolvedGrant } from "../model/grant.js";
import type { Scope, ScopeChain } from "../model/scope.js";
import { scopeEquals } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import { subjectEquals } from "../model/subject.js";
import type { GrantSource, GrantStore } from "../ports/index.js";

// The in-memory reference GrantStore: the executable definition of the
// GrantSource contract (grantsFor returns EXACTLY the grants matching
// subjects × scopeChain, via the same filter the pure evaluator uses). The
// conformance runner builds engines on it; hosts can use it in tests.

export function memoryGrantSource(grants: readonly ResolvedGrant[]): GrantSource {
  return {
    grantsFor: (subjects: readonly Subject[], scopeChain: ScopeChain) =>
      Promise.resolve(applicableGrants(grants, subjects, scopeChain)),
  };
}

export interface MemoryPolicy {
  id: string;
  name: string;
  statements: ResolvedGrant["statements"];
}

export class MemoryGrantStore implements GrantStore {
  private readonly grants: Array<GrantRecord & { statements: ResolvedGrant["statements"]; }> = [];
  private readonly policies = new Map<string, MemoryPolicy>();
  private nextId = 1;

  constructor(private readonly rootScope?: Scope) {}

  addPolicy(policy: MemoryPolicy): void {
    this.policies.set(policy.id, policy);
  }

  // Pre-resolved seeding (conformance fixtures carry statements inline).
  seed(grant: ResolvedGrant): void {
    this.policies.set(grant.policyId, {
      id: grant.policyId,
      name: grant.policyName,
      statements: grant.statements,
    });
    this.grants.push({
      id: `g${this.nextId++}`,
      policyId: grant.policyId,
      policyName: grant.policyName,
      subject: grant.subject,
      scope: grant.scope,
      ...(grant.bounds !== undefined ? { bounds: grant.bounds } : {}),
      createdBy: null,
      createdAt: new Date(0).toISOString(),
      statements: grant.statements,
    });
  }

  async grantsFor(subjects: readonly Subject[], scopeChain: ScopeChain): Promise<ResolvedGrant[]> {
    return applicableGrants(this.grants, subjects, scopeChain).map((g) => ({
      policyId: g.policyId,
      policyName: g.policyName,
      subject: g.subject,
      scope: g.scope,
      statements: g.statements,
      ...(g.bounds !== undefined ? { bounds: g.bounds } : {}),
    }));
  }

  // Idempotent, root-id-normalizing — the same contract as the pg backend.
  async createGrant(input: {
    policyId: string;
    subject: Subject;
    scope: Scope;
    bounds?: GrantBounds;
    createdBy: string | null;
  }): Promise<void> {
    const policy = this.policies.get(input.policyId);
    if (!policy) throw new Error(`unknown policy ${input.policyId}`);
    const scope = this.rootScope && input.scope.kind === this.rootScope.kind
      ? this.rootScope
      : input.scope;
    const existing = this.grants.find((g) =>
      g.policyId === input.policyId
      && subjectEquals(g.subject, input.subject)
      && scopeEquals(g.scope, scope)
    );
    if (existing) {
      // Replace, matching the pg backend: re-granting to tighten a limit must
      // not silently keep the old one.
      if (input.bounds === undefined) delete existing.bounds;
      else existing.bounds = input.bounds;
      return;
    }
    this.grants.push({
      id: `g${this.nextId++}`,
      policyId: policy.id,
      policyName: policy.name,
      subject: input.subject,
      scope,
      ...(input.bounds !== undefined ? { bounds: input.bounds } : {}),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      statements: policy.statements,
    });
  }

  async deleteGrant(id: string): Promise<boolean> {
    const i = this.grants.findIndex((g) => g.id === id);
    if (i === -1) return false;
    this.grants.splice(i, 1);
    return true;
  }

  async deleteGrantsForSubject(subject: Subject): Promise<number> {
    return this.remove((g) => subjectEquals(g.subject, subject));
  }

  async deleteGrantsForPolicy(policyId: string): Promise<number> {
    return this.remove((g) => g.policyId === policyId);
  }

  private remove(match: (g: GrantRecord) => boolean): number {
    const before = this.grants.length;
    for (let i = this.grants.length - 1; i >= 0; i--) {
      if (match(this.grants[i]!)) this.grants.splice(i, 1);
    }
    return before - this.grants.length;
  }
}
