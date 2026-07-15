import { isValidAction, isValidResource, type PolicyStatement } from "../model/statement.js";
import { validateConditions } from "./conditions.js";
import type { ValidationVocabulary } from "./validate.js";

export interface DraftVocabulary extends ValidationVocabulary {
  // Host resource whitelist beyond the shape rule (e.g. "a tool: resource
  // must name a real tool, wildcards excepted"). Omitted ⇒ every shape-valid
  // resource is kept.
  isKnownResource?: (resource: string) => boolean;
}

export interface DraftResult {
  ok: boolean;
  name: string;
  description: string | null;
  statements: PolicyStatement[];
  warnings: string[];
  error?: string;
}

// Schema + vocabulary validation for an AI-drafted policy: the model's raw
// JSON is never trusted. Unknown/hallucinated actions and unknown resources
// are dropped statement-by-statement (repair); a statement left with no valid
// actions or resources is dropped entirely; a draft left with no statements
// at all is rejected (ok: false). This is the ONLY thing standing between a
// hallucinated identifier and a policy a builder UI would render as
// legitimate — it never persists anything itself either way.
export function repairDraft(raw: unknown, vocabulary: DraftVocabulary): DraftResult {
  const warnings: string[] = [];
  const obj = raw as { name?: unknown; description?: unknown; statements?: unknown; } | null;
  const name = typeof obj?.name === "string" ? obj.name.trim().slice(0, 60) : "";
  const description = typeof obj?.description === "string" && obj.description.trim()
    ? obj.description.trim().slice(0, 300)
    : null;
  const rawStatements = Array.isArray(obj?.statements) ? obj!.statements : [];

  const statements: PolicyStatement[] = [];
  for (const s of rawStatements) {
    const st = s as { effect?: unknown; actions?: unknown; resources?: unknown; } | null;
    if (!st || (st.effect !== "allow" && st.effect !== "deny")) {
      warnings.push("dropped a statement with an invalid or missing effect");
      continue;
    }
    const actions = (Array.isArray(st.actions) ? st.actions : []).filter((a: unknown) => {
      const good = typeof a === "string" && isValidAction(a, vocabulary.isKnownAction);
      if (!good) warnings.push(`dropped unknown action "${String(a)}"`);
      return good;
    }) as string[];
    const resources = (Array.isArray(st.resources) ? st.resources : []).filter((r: unknown) => {
      if (typeof r !== "string" || !isValidResource(r)) {
        warnings.push(`dropped invalid resource "${String(r)}"`);
        return false;
      }
      if (vocabulary.isKnownResource && !vocabulary.isKnownResource(r)) {
        warnings.push(`dropped unknown resource "${r}"`);
        return false;
      }
      return true;
    }) as string[];
    if (actions.length === 0 || resources.length === 0) {
      warnings.push("dropped a statement left with no valid actions or resources");
      continue;
    }
    // Conditions on a draft statement: all-or-nothing. Removing an individual
    // invalid condition would WIDEN the statement (a condition only ever
    // narrows), so a statement with any invalid condition is dropped whole
    // rather than repaired.
    const rawConditions = (s as { conditions?: unknown; }).conditions;
    let conditions: PolicyStatement["conditions"];
    if (rawConditions !== undefined) {
      const v = validateConditions(rawConditions, vocabulary.conditionKeys);
      if (!v.ok) {
        warnings.push(
          `dropped a statement with invalid conditions (${v.error}) — a condition is never `
            + "silently removed",
        );
        continue;
      }
      conditions = v.conditions;
    }
    statements.push({
      effect: st.effect,
      actions,
      resources,
      ...(conditions !== undefined ? { conditions } : {}),
    });
  }

  if (statements.length === 0) {
    return {
      ok: false,
      name,
      description,
      statements: [],
      warnings,
      error: "the draft contained no usable statements after removing invalid or hallucinated "
        + "actions/resources — try describing the intent differently",
    };
  }
  return { ok: true, name: name || "ai-draft", description, statements, warnings };
}
