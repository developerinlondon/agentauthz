// Policy statements. The model and its rationale are documented in the
// README under "Semantics (the contract)"; what follows is the enforcement.

import type { PolicyCondition } from "./condition.js";

export type Effect = "allow" | "deny";

export interface PolicyStatement {
  effect: Effect;
  actions: string[];
  resources: string[];
  // Optional ABAC conditions: typed {operator, key, value} narrowings
  // evaluated fail-closed on top of the action+resource match — see
  // core/conditions.ts for the operator whitelist and allow-vs-deny semantics.
  conditions?: PolicyCondition[];
}

// A statement action is valid iff the host-declared registry knows it. Any `*`
// disqualifies it — actions never carry wildcards (resources do, see below).
export function isValidAction(action: string, isKnownAction: (action: string) => boolean): boolean {
  if (action.includes("*")) return false;
  return isKnownAction(action);
}

// A resource pattern is valid iff it's a non-empty string with at most one `*`,
// and only as the final character (exact match, or a trailing-`*` prefix).
export function isValidResource(resource: string): boolean {
  if (resource.length === 0) return false;
  const star = resource.indexOf("*");
  return star === -1 || star === resource.length - 1;
}

// Requested action ⟷ statement action: exact equality (no wildcards on actions).
export function actionMatches(pattern: string, requested: string): boolean {
  return pattern === requested;
}

// Requested resource ⟷ statement resource: exact, or trailing-`*` prefix match.
export function resourceMatches(pattern: string, requested: string): boolean {
  if (pattern.endsWith("*")) return requested.startsWith(pattern.slice(0, -1));
  return pattern === requested;
}
