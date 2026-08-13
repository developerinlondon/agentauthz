import type { AdminAuditRecord, SubjectSummary } from "../admin/types.js";
import type { PolicyCondition } from "../model/condition.js";
import { type AuthzDescriptor } from "../model/descriptor.js";
import type { GrantRecord, PolicyRecord } from "../model/grant.js";
import type { Scope } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import { type AuthzAdminClient, type FetchLike } from "./client.js";
export interface UseAuthzAdminOptions {
    baseUrl: string;
    fetch?: FetchLike;
}
export interface AuthzAdminState {
    loading: boolean;
    error: string | null;
    descriptor: AuthzDescriptor | null;
    grants: GrantRecord[];
    policies: PolicyRecord[];
    audit: AdminAuditRecord[];
    client: AuthzAdminClient;
    reload(): Promise<void>;
    loadAudit(query?: Record<string, string>): Promise<void>;
    searchSubjects(q: string): Promise<SubjectSummary[]>;
    createGrant(input: {
        policyId: string;
        subject: Subject;
        scope: Scope;
        bounds?: PolicyCondition[];
    }): Promise<void>;
    revokeGrant(id: string): Promise<void>;
    coverageFor(policyId: string): {
        granted: string[];
        excluded: string[];
    };
}
export declare function useAuthzAdmin(options: UseAuthzAdminOptions): AuthzAdminState;
//# sourceMappingURL=useAuthzAdmin.d.ts.map