import type { ConditionKeys } from "../model/condition.js";
import type { GrantBounds } from "../model/grant.js";
import type { Subject } from "../model/subject.js";
import type { AuditSink } from "../ports/index.js";
export type BoundsResult = {
    ok: true;
    bounds: GrantBounds;
} | {
    ok: false;
    error: string;
};
export declare function normalizeBounds(raw: unknown, keys: ConditionKeys): BoundsResult;
export declare function recordAdminWrite(sink: AuditSink | undefined, actor: Subject | null, action: string, resource: string, detail: Record<string, unknown>, source: string): void;
//# sourceMappingURL=writes.d.ts.map