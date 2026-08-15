import { type Kysely } from "kysely";
import { AuthzError } from "../../model/errors.js";
import type { GrantBounds, GrantRecord, PolicyRecord, ResolvedGrant } from "../../model/grant.js";
import type { Scope, ScopeChain } from "../../model/scope.js";
import type { PolicyStatement } from "../../model/statement.js";
import type { Subject } from "../../model/subject.js";
import type { AuditEvent, GrantStore } from "../../ports/index.js";
import type { PgAuthzConfig } from "./config.js";
export declare class SystemPolicyError extends AuthzError {
}
export interface AuditRecord {
    id: string;
    at: string;
    subject: Subject;
    action: string;
    resource: string;
    decision: string;
    source: string;
    detail: Record<string, unknown> | null;
}
export interface PolicySummary extends PolicyRecord {
    attachments: Subject[];
}
export declare class PgAuthzStore implements GrantStore {
    private readonly config;
    private readonly db;
    private readonly retentionDays;
    private readonly inflight;
    constructor(db: Kysely<any>, config: PgAuthzConfig);
    grantsFor(subjects: readonly Subject[], scopeChain: ScopeChain): Promise<ResolvedGrant[]>;
    createGrant(input: {
        policyId: string;
        subject: Subject;
        scope: Scope;
        bounds?: GrantBounds;
        createdBy: string | null;
    }): Promise<void>;
    getGrant(id: string): Promise<GrantRecord | null>;
    listGrants(filter?: {
        scopeKind?: string;
        scopeId?: string;
        policyId?: string;
        subjectKind?: string;
        subjectId?: string;
    }): Promise<GrantRecord[]>;
    deleteGrant(id: string): Promise<boolean>;
    deleteGrantAt(policyId: string, subject: Subject, scope: Scope): Promise<boolean>;
    deleteGrantsForSubject(subject: Subject): Promise<number>;
    deleteGrantsForPolicy(policyId: string): Promise<number>;
    attachPolicy(policyId: string, subject: Subject): Promise<void>;
    detachPolicy(policyId: string, subject: Subject): Promise<boolean>;
    listAttachments(policyId: string): Promise<Subject[]>;
    createPolicy(input: {
        name: string;
        description: string | null;
        statements: PolicyStatement[];
        createdBy: string | null;
    }): Promise<PolicyRecord>;
    getPolicy(id: string): Promise<PolicyRecord | null>;
    listPolicies(): Promise<PolicySummary[]>;
    duplicatePolicy(id: string, name: string, createdBy: string | null): Promise<PolicyRecord>;
    updatePolicy(id: string, input: {
        name: string;
        description: string | null;
        statements: PolicyStatement[];
    }): Promise<PolicyRecord | null>;
    deletePolicy(id: string): Promise<boolean>;
    record(event: AuditEvent): void;
    flushAudit(): Promise<void>;
    sweepAudit(): Promise<number>;
    private maybeSweep;
    listAudit(opts: {
        subjectId?: string;
        action?: string;
        before?: string;
        limit?: number;
    }): Promise<AuditRecord[]>;
    private grantQuery;
    private grantRecord;
}
//# sourceMappingURL=store.d.ts.map