// The pure statement engine: zero deps, no I/O. Given the applicable grants,
// deny-wins — a deny granted at ANY scope in the resolved chain beats an
// allow from any other; nothing granted ⇒ deny. `evaluate` additionally does
// the subject/scope matching itself from a raw grant list, which makes it the
// executable reference the conformance fixtures run against: a storage
// backend's filtered `grantsFor` must be decision-identical to this filter.

import { type ActionMatch, type ActionParentLookup, matchAction } from "../model/action.js";
import type { ConditionContext, ConditionKeys } from "../model/condition.js";
import type { ResolvedGrant } from "../model/grant.js";
import { isValidScope, type Scope, type ScopeChain, scopeEquals } from "../model/scope.js";
import { resourceMatches } from "../model/statement.js";
import { isValidSubject, type Subject, subjectEquals } from "../model/subject.js";
import { evalConditions } from "./conditions.js";

// Does any statement in `grants` match (action, resource, ctx) with `effect`?
// Conditions are an ADDITIONAL narrowing on a statement that already matched
// by action+resource, with asymmetric fail-closed semantics (see
// core/conditions.ts): an ALLOW statement contributes only on a definitive
// conditions "match"; a DENY statement fires on "match" AND on "unmatchable"
// (a deny whose condition cannot be evaluated stays standing rather than
// silently lifting), stepping aside only on a definitive "no-match". A
// conditionless statement evaluates exactly as if conditions never existed —
// evalConditions returns "match" for absent conditions.
function has(
  grants: readonly ResolvedGrant[],
  effect: "allow" | "deny",
  action: string,
  resource: string,
  ctx: ConditionContext,
  keys: ConditionKeys,
  parentOf?: ActionParentLookup,
): boolean {
  for (const g of grants) {
    for (const s of g.statements) {
      if (s.effect !== effect) continue;
      // Action matching is tri-state once derivation is in play, and resolves
      // asymmetrically for the same reason conditions do: an allow needs a
      // definitive match, a deny also fires on an unresolvable ancestry rather
      // than quietly ceasing to cover the leaves it names.
      const actionVerdict = s.actions.reduce<ActionMatch>(
        (best, a) => best === "match" ? best : worseOf(best, matchAction(a, action, parentOf)),
        "no-match",
      );
      if (effect === "allow" ? actionVerdict !== "match" : actionVerdict === "no-match") continue;
      if (!s.resources.some((r) => resourceMatches(r, resource))) continue;
      const verdict = evalConditions(s.conditions, ctx, keys);
      if (effect === "allow" ? verdict === "match" : verdict !== "no-match") return true;
    }
  }
  return false;
}

// Across a statement's actions, keep the strongest signal: a definitive match
// beats an unresolvable walk, which in turn beats a plain no-match.
function worseOf(a: ActionMatch, b: ActionMatch): ActionMatch {
  if (a === "match" || b === "match") return "match";
  if (a === "unresolvable" || b === "unresolvable") return "unresolvable";
  return "no-match";
}

// Deny-wins over an already-applicable grant set: an explicit deny beats any
// allow; nothing matched ⇒ deny.
export function decide(
  grants: readonly ResolvedGrant[],
  action: string,
  resource: string,
  ctx: ConditionContext,
  keys: ConditionKeys,
  parentOf?: ActionParentLookup,
): "allow" | "deny" {
  if (has(grants, "deny", action, resource, ctx, keys, parentOf)) return "deny";
  return has(grants, "allow", action, resource, ctx, keys, parentOf) ? "allow" : "deny";
}

// Which of `grants` apply to (subjects, scopeChain)? A grant applies when its
// subject is one of the caller's subjects (exact {kind, id} equality — a
// dangling or foreign reference never matches) AND its scope is one of the
// chain's scopes. Inheritance can only ever ADD statements to consider: a
// leaf grant never leaks upward or into a sibling because a sibling's chain
// never contains that leaf.
export function applicableGrants(
  grants: readonly ResolvedGrant[],
  subjects: readonly Subject[],
  scopeChain: ScopeChain,
): ResolvedGrant[] {
  return grants.filter((g) =>
    subjects.some((s) => subjectEquals(g.subject, s))
    && scopeChain.some((sc) => scopeEquals(g.scope, sc))
  );
}

export interface EvaluateInput {
  // The full grant universe to consider (e.g. everything a store returned).
  grants: readonly ResolvedGrant[];
  // The caller's explicit {kind, id} subjects, host-resolved.
  subjects: readonly Subject[];
  action: string;
  resource: string;
  // Ordered host-resolved chain, root first. Taken as unknown-shaped caller
  // input: any malformed entry, or a kind outside `scopeKinds` when declared,
  // DENIES outright (fail closed) — it never silently evaluates a different
  // chain than the caller named.
  scopeChain: ScopeChain;
  // Host-populated condition context (declared keys). Built-in request:*
  // entries should already be merged in (builtinContextEntries).
  context: ConditionContext;
  // Declared condition keys, merged with built-ins (resolveConditionKeys).
  conditionKeys: ConditionKeys;
  // When given, every chain entry's kind must be one of these.
  scopeKinds?: readonly string[];
  // Host-declared action derivation; absent ⇒ actions match exactly.
  actionParentOf?: ActionParentLookup;
}

// The pure end-to-end decision: validate inputs fail-closed, filter the
// applicable grants, decide deny-wins.
export function evaluate(input: EvaluateInput): "allow" | "deny" {
  if (!Array.isArray(input.scopeChain)) return "deny";
  for (const scope of input.scopeChain) {
    if (!isValidScope(scope)) return "deny";
    if (input.scopeKinds && !input.scopeKinds.includes((scope as Scope).kind)) return "deny";
  }
  // A malformed subject entry can never match a grant; drop it rather than
  // letting it near the comparison at all.
  const subjects = Array.isArray(input.subjects) ? input.subjects.filter(isValidSubject) : [];
  const grants = applicableGrants(input.grants, subjects, input.scopeChain);
  return decide(
    grants,
    input.action,
    input.resource,
    input.context,
    input.conditionKeys,
    input.actionParentOf,
  );
}
