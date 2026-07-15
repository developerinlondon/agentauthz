import type { ConditionKeys } from "../model/condition.js";
import { isValidAction, isValidResource, type PolicyStatement } from "../model/statement.js";
import { validateConditions } from "./conditions.js";

export type Validation =
  | { ok: true; statements: PolicyStatement[]; }
  | { ok: false; error: string; };

export interface ValidationVocabulary {
  // The host's closed action registry. Actions never carry wildcards; a `*`
  // anywhere disqualifies before this is even consulted.
  isKnownAction: (action: string) => boolean;
  // Host-declared condition keys, already merged with the built-ins
  // (resolveConditionKeys).
  conditionKeys: ConditionKeys;
}

// Validate a parsed `statements` value (fails closed): a non-empty array of
// { effect: allow|deny, actions: [valid…], resources: [valid…] }. The error
// names the first offending piece so a UI can surface it verbatim.
export function validateStatements(input: unknown, vocabulary: ValidationVocabulary): Validation {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "statements must be a non-empty array" };
  }
  const out: PolicyStatement[] = [];
  for (let i = 0; i < input.length; i++) {
    const s = input[i] as Record<string, unknown>;
    if (!s || typeof s !== "object") return { ok: false, error: `statement ${i} is not an object` };
    if (s.effect !== "allow" && s.effect !== "deny") {
      return { ok: false, error: `statement ${i}: effect must be "allow" or "deny"` };
    }
    if (!Array.isArray(s.actions) || s.actions.length === 0) {
      return { ok: false, error: `statement ${i}: actions must be a non-empty array` };
    }
    if (!Array.isArray(s.resources) || s.resources.length === 0) {
      return { ok: false, error: `statement ${i}: resources must be a non-empty array` };
    }
    for (const a of s.actions) {
      if (typeof a !== "string" || !isValidAction(a, vocabulary.isKnownAction)) {
        return { ok: false, error: `statement ${i}: unknown or wildcard action "${String(a)}"` };
      }
    }
    for (const r of s.resources) {
      if (typeof r !== "string" || !isValidResource(r)) {
        return {
          ok: false,
          error: `statement ${i}: resource "${String(r)}" — only a single trailing * is allowed`,
        };
      }
    }
    // Optional ABAC conditions: validated against the typed operator/key
    // whitelist, fail-closed — a condition the evaluator could never evaluate
    // is rejected at save time, not stored.
    let conditions: PolicyStatement["conditions"];
    if (s.conditions !== undefined) {
      const v = validateConditions(s.conditions, vocabulary.conditionKeys);
      if (!v.ok) return { ok: false, error: `statement ${i}: ${v.error}` };
      conditions = v.conditions;
    }
    out.push({
      effect: s.effect,
      actions: s.actions as string[],
      resources: s.resources as string[],
      ...(conditions !== undefined ? { conditions } : {}),
    });
  }
  return { ok: true, statements: out };
}
