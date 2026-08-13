import type { GrantBounds, GrantRecord, PolicyRecord } from "../model/grant.js";
import type { Scope } from "../model/scope.js";
import type { Subject } from "../model/subject.js";

export interface AdminAuditRecord {
  id: string;
  at: string;
  subject: Subject;
  action: string;
  resource: string;
  decision: string;
  source: string;
  detail: Record<string, unknown> | null;
}

// What the admin routes need from storage, named as its own port so the
// handlers never depend on the pg backend. PgAuthzStore satisfies it as-is.
export interface AdminStore {
  listGrants(filter: {
    scopeKind?: string;
    scopeId?: string;
    policyId?: string;
    subjectKind?: string;
    subjectId?: string;
  }): Promise<GrantRecord[]>;
  createGrant(input: {
    policyId: string;
    subject: Subject;
    scope: Scope;
    bounds?: GrantBounds;
    createdBy: string | null;
  }): Promise<void>;
  deleteGrant(id: string): Promise<boolean>;
  listPolicies(): Promise<PolicyRecord[]>;
  listAudit(opts: {
    subjectId?: string;
    action?: string;
    before?: string;
    limit?: number;
  }): Promise<AdminAuditRecord[]>;
}

export interface SubjectSummary {
  kind: string;
  id: string;
  label?: string;
}

// Enumeration for the subject picker. Separate from the SubjectDirectory port
// (which only answers exists()) because a host may be able to validate a
// subject without being willing to list every one it has.
export interface SubjectLister {
  list(query: { q?: string; kind?: string; limit?: number; }): Promise<SubjectSummary[]>;
}
