import type { AdminAuditRecord, SubjectSummary } from "../admin/types.js";
import type { PolicyCondition } from "../model/condition.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { GrantRecord, PolicyRecord } from "../model/grant.js";
import type { Scope } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface AuthzAdminClient {
    descriptor(): Promise<AuthzDescriptor>;
    grants(filter?: Record<string, string>): Promise<GrantRecord[]>;
    policies(): Promise<PolicyRecord[]>;
    subjects(query?: Record<string, string>): Promise<SubjectSummary[]>;
    audit(query?: Record<string, string>): Promise<AdminAuditRecord[]>;
    createGrant(input: {
        policyId: string;
        subject: Subject;
        scope: Scope;
        bounds?: PolicyCondition[];
    }): Promise<void>;
    revokeGrant(id: string): Promise<void>;
}
export declare class AuthzAdminError extends Error {
}
export declare function createClient(baseUrl: string, doFetch: FetchLike): AuthzAdminClient;
//# sourceMappingURL=client.d.ts.map