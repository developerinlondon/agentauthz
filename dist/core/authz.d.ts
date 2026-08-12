import type { ConditionKeys } from "../model/condition.js";
import type { ResolvedGrant } from "../model/grant.js";
import { type ScopeChain } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import type { ActionRegistry, AuditSink, GrantStore, ScopeRoleSynthesizer } from "../ports/index.js";
export interface CheckOpts {
    source?: string;
    silent?: boolean;
    scopeChain?: ScopeChain;
    context?: Record<string, string | number | string[]>;
    sourceIp?: string | null;
    bypass?: boolean;
    auditDetail?: Record<string, unknown> | null;
    now?: Date;
}
export interface CheckDetail {
    decision: "allow" | "deny" | "admin_bypass";
    allowed: boolean;
    allowedByStoredGrants: boolean;
}
export interface Authz {
    check(subjects: readonly Subject[], action: string, resource: string, opts?: CheckOpts): Promise<boolean>;
    checkDetailed(subjects: readonly Subject[], action: string, resource: string, opts?: CheckOpts): Promise<CheckDetail>;
    listGrantsFor(subjects: readonly Subject[], scopeChain?: ScopeChain): Promise<ResolvedGrant[]>;
}
export interface AuthzOptions {
    grantStore: GrantStore;
    conditionKeys?: ConditionKeys;
    scopeKinds?: readonly string[];
    defaultScopeChain?: ScopeChain;
    synthesizers?: readonly ScopeRoleSynthesizer[];
    auditSink?: AuditSink;
    actionRegistry?: ActionRegistry;
}
export declare function makeAuthz(options: AuthzOptions): Authz;
//# sourceMappingURL=authz.d.ts.map