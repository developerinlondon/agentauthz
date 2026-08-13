import type { AuthzDescriptor } from "../model/descriptor.js";
import { type Subject } from "../model/subject.js";
import type { AuditSink } from "../ports/index.js";
import type { AdminStore, SubjectLister } from "./types.js";
export interface AdminSurfaceOptions {
    descriptor: AuthzDescriptor;
    store: AdminStore;
    subjects?: SubjectLister;
    basePath?: string;
    actor?: (request: Request) => Subject | null;
    auditSink?: AuditSink;
}
export declare function createAdminHandler(opts: AdminSurfaceOptions): (request: Request) => Promise<Response>;
//# sourceMappingURL=handler.d.ts.map