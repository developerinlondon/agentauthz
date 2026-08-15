// The write-path pieces every administrative surface needs, held apart from
// the HTTP handlers so a second surface (MCP, a CLI) cannot drift from them:
// the same bounds validation and the same audit row for the same act.
import { validateConditions } from "../core/conditions.js";
// Absent bounds are an unbounded grant, not an error. The failure message is
// validateConditions' own, verbatim, so every surface reports the rejection in
// the engine's words rather than a paraphrase of them.
export function normalizeBounds(raw, keys) {
    if (raw === undefined || raw === null)
        return { ok: true, bounds: [] };
    if (!Array.isArray(raw))
        return { ok: false, error: "bounds must be an array" };
    if (raw.length === 0)
        return { ok: true, bounds: [] };
    const v = validateConditions(raw, keys);
    if (!v.ok)
        return { ok: false, error: v.error };
    return { ok: true, bounds: v.conditions };
}
export function recordAdminWrite(sink, actor, action, resource, detail, source) {
    sink?.record({
        subjects: actor ? [actor] : [],
        action,
        resource,
        decision: "executed",
        source,
        detail,
    });
}
//# sourceMappingURL=writes.js.map