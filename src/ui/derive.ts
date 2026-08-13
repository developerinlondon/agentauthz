// The descriptor -> form derivation, kept pure and free of React so the claim
// "adding a condition key server-side produces a new field with no frontend
// change" is directly testable.

import type { PolicyCondition } from "../model/condition.js";
import type { AuthzDescriptor, DescribedConditionKey } from "../model/descriptor.js";

export type ControlKind = "text" | "number" | "datetime" | "cidr" | "multi";

export interface BoundField {
  key: string;
  spec: DescribedConditionKey;
  // Host-declared keys only. A UI must not offer a request:* key as a bound:
  // the engine populates those per check, so an author cannot set one here.
  selectable: boolean;
}

export function boundFields(descriptor: AuthzDescriptor): BoundField[] {
  return Object.entries(descriptor.conditionKeys).map(([key, spec]) => ({
    key,
    spec,
    selectable: spec.builtIn !== true,
  }));
}

// A set operator takes a list whatever the key's type, so the operator decides
// the control before the type does.
export function controlFor(
  spec: DescribedConditionKey,
  operator: string,
  setOperators: readonly string[],
): ControlKind {
  if (setOperators.includes(operator)) return "multi";
  switch (spec.type) {
    case "number":
      return "number";
    case "date":
      return "datetime";
    case "ip":
      return "cidr";
    default:
      return "text";
  }
}

export interface DraftBound {
  key: string;
  operator: string;
  value: string;
  values: string[];
}

// A scalar operator emits `value`, a set operator emits `values` — never both,
// which the engine reads as an unmatchable condition.
export function toCondition(
  draft: DraftBound,
  setOperators: readonly string[],
): PolicyCondition {
  return setOperators.includes(draft.operator)
    ? { operator: draft.operator, key: draft.key, values: draft.values.filter((v) => v.length > 0) }
    : { operator: draft.operator, key: draft.key, value: draft.value };
}

export interface Coverage {
  granted: string[];
  excluded: string[];
}

// What a policy's allow statements actually confer, expanded through the
// derivation closure — the difference between "granted content-author" and
// four named actions a reviewer can check.
export function coverageOf(
  descriptor: AuthzDescriptor,
  statements: ReadonlyArray<{ effect: string; actions: string[]; }>,
): Coverage {
  const expand = (names: readonly string[]) => {
    const out = new Set<string>();
    for (const a of names) {
      out.add(a);
      for (const d of descriptor.actionClosures[a] ?? []) out.add(d);
    }
    return out;
  };
  const granted = expand(statements.filter((s) => s.effect === "allow").flatMap((s) => s.actions));
  const excluded = expand(statements.filter((s) => s.effect === "deny").flatMap((s) => s.actions));
  for (const a of excluded) granted.delete(a);
  return { granted: [...granted].sort(), excluded: [...excluded].sort() };
}

export class UnsupportedDescriptorError extends Error {}

// Refuse a document this build does not understand rather than render a
// half-correct form against it.
export function assertSupported(descriptor: AuthzDescriptor, supported: number): void {
  if (descriptor.version !== supported) {
    throw new UnsupportedDescriptorError(
      `this admin UI understands descriptor version ${supported}, `
        + `but the server serves version ${String(descriptor.version)}`,
    );
  }
}
