// The seams a host (or storage backend) plugs into the engine. Core depends
// only on these interfaces; backends/pg is the reference implementation, and
// any alternative backend must be decision-identical (the conformance/
// fixtures are the contract).

import {
  type ActionCatalogueEntry,
  type ActionParentLookup,
  collectDescendants,
  indexActionCatalogue,
} from "../model/action.js";
import type { ConditionKeys } from "../model/condition.js";
import type { ResolvedGrant } from "../model/grant.js";
import type { ScopeChain } from "../model/scope.js";
import type { Subject } from "../model/subject.js";

export type { ConditionKeys };

// The host's closed action registry. Statement actions must be known here;
// there is NO action wildcard (the resource side wildcards instead).
export interface ActionRegistry {
  isKnownAction(action: string): boolean;
  // Declared derivation, when the host has one. A statement naming the parent
  // covers every action deriving from it, allow and deny alike.
  parentOf?: ActionParentLookup;
  // Everything deriving transitively from `action`, so a host can render the
  // exact set a statement permits instead of an opaque coarse name.
  descendantsOf?(action: string): string[];
}

export function actionRegistryFromList(actions: readonly string[]): ActionRegistry {
  const set = new Set(actions);
  return { isKnownAction: (action) => set.has(action) };
}

// Builds a registry from a declared catalogue, validating that every parent is
// itself declared and that the graph is acyclic. Throws on a bad vocabulary.
export function actionRegistryFromCatalogue(
  entries: readonly ActionCatalogueEntry[],
): ActionRegistry {
  const { parents, children, actions } = indexActionCatalogue(entries);
  return {
    isKnownAction: (action) => actions.has(action),
    parentOf: (action) => parents.get(action),
    descendantsOf: (action) => collectDescendants(children, action),
  };
}

// Evaluation-facing grant lookup: EXACTLY the grants whose subject is one of
// `subjects` (exact {kind, id} equality) and whose scope is one of the
// chain's scopes — decision-identical to core/evaluate.ts applicableGrants
// over the same universe. Over-returning is a correctness bug, not a
// widening: the engine unions what it's given.
export interface GrantSource {
  grantsFor(subjects: readonly Subject[], scopeChain: ScopeChain): Promise<ResolvedGrant[]>;
}

// App-owned role rows (e.g. a membership table) become grants at check time —
// one storage, no dual-write. A synthesizer returns already-applicable grants
// for (subjects, scopeChain); the engine unions them with the store's and
// applies the same deny-wins, so a synthesized role is confined exactly like
// a stored grant at the same scope.
export type ScopeRoleSynthesizer = GrantSource;

// Grant storage: the evaluation lookup plus the management surface.
// createGrant is idempotent — re-granting the same (policy, subject, scope)
// is a no-op.
export interface GrantStore extends GrantSource {
  createGrant(input: {
    policyId: string;
    subject: Subject;
    scope: { kind: string; id: string; };
    createdBy: string | null;
  }): Promise<void>;
  deleteGrant(id: string): Promise<boolean>;
  // Revocation: remove a subject's grants at EVERY scope — a revoked subject
  // must not keep a deep-scope grant waiting for a future same-named subject.
  deleteGrantsForSubject(subject: Subject): Promise<number>;
  deleteGrantsForPolicy(policyId: string): Promise<number>;
}

export type AuditDecision = "allow" | "deny" | "admin_bypass" | "executed";

export interface AuditEvent {
  // The caller's subjects; empty = anonymous. The sink chooses how to label
  // them (the pg backend records the first as the primary subject).
  subjects: readonly Subject[];
  action: string;
  resource: string;
  decision: AuditDecision;
  // The door the check came through (host-named).
  source: string;
  detail: Record<string, unknown> | null;
}

// The audit seam. record() is fire-and-forget from the engine's point of
// view: an audit outage must never break authorization, so implementations
// swallow write failures and never propagate to the request path.
export interface AuditSink {
  record(event: AuditEvent): void;
}

// Optional host lookup for admin surfaces (e.g. validating that a grant's
// subject names something real before storing it). Never consulted during
// evaluation — a dangling reference simply never matches.
export interface SubjectDirectory {
  exists(subject: Subject): Promise<boolean>;
}
