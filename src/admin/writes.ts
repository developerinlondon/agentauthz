// The write-path pieces every administrative surface needs, held apart from
// the HTTP handlers so a second surface (MCP, a CLI) cannot drift from them:
// the same bounds validation and the same audit row for the same act.

import { validateConditions } from "../core/conditions.js";
import type { ConditionKeys } from "../model/condition.js";
import type { GrantBounds } from "../model/grant.js";
import type { Subject } from "../model/subject.js";
import type { AuditSink } from "../ports/index.js";

export type BoundsResult =
  | { ok: true; bounds: GrantBounds; }
  | { ok: false; error: string; };

// Absent bounds are an unbounded grant, not an error. The failure message is
// validateConditions' own, verbatim, so every surface reports the rejection in
// the engine's words rather than a paraphrase of them.
export function normalizeBounds(raw: unknown, keys: ConditionKeys): BoundsResult {
  if (raw === undefined || raw === null) return { ok: true, bounds: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "bounds must be an array" };
  if (raw.length === 0) return { ok: true, bounds: [] };
  const v = validateConditions(raw, keys);
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, bounds: v.conditions };
}

export function recordAdminWrite(
  sink: AuditSink | undefined,
  actor: Subject | null,
  action: string,
  resource: string,
  detail: Record<string, unknown>,
  source: string,
): void {
  sink?.record({
    subjects: actor ? [actor] : [],
    action,
    resource,
    decision: "executed",
    source,
    detail,
  });
}
