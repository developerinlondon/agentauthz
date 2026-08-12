import type { Scope } from "./scope.js";
import type { PolicyStatement } from "./statement.js";
import type { Subject } from "./subject.js";
export interface PolicyRecord {
    id: string;
    name: string;
    description: string | null;
    statements: PolicyStatement[];
    system: boolean;
    updatedAt: string;
}
export interface GrantRecord {
    id: string;
    policyId: string;
    policyName: string;
    subject: Subject;
    scope: Scope;
    createdBy: string | null;
    createdAt: string;
}
export interface ResolvedGrant {
    policyId: string;
    policyName: string;
    subject: Subject;
    scope: Scope;
    statements: PolicyStatement[];
}
//# sourceMappingURL=grant.d.ts.map