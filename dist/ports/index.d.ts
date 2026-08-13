import { type ActionCatalogueEntry, type ActionParentLookup } from "../model/action.js";
import type { ConditionKeys } from "../model/condition.js";
import type { ResolvedGrant } from "../model/grant.js";
import type { ScopeChain } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
export type { ConditionKeys };
export interface ActionRegistry {
    isKnownAction(action: string): boolean;
    parentOf?: ActionParentLookup;
    descendantsOf?(action: string): string[];
    listActions?(): string[];
}
export declare function actionRegistryFromList(actions: readonly string[]): ActionRegistry;
export declare function actionRegistryFromCatalogue(entries: readonly ActionCatalogueEntry[]): ActionRegistry;
export interface GrantSource {
    grantsFor(subjects: readonly Subject[], scopeChain: ScopeChain): Promise<ResolvedGrant[]>;
}
export type ScopeRoleSynthesizer = GrantSource;
export interface GrantStore extends GrantSource {
    createGrant(input: {
        policyId: string;
        subject: Subject;
        scope: {
            kind: string;
            id: string;
        };
        createdBy: string | null;
    }): Promise<void>;
    deleteGrant(id: string): Promise<boolean>;
    deleteGrantsForSubject(subject: Subject): Promise<number>;
    deleteGrantsForPolicy(policyId: string): Promise<number>;
}
export type AuditDecision = "allow" | "deny" | "admin_bypass" | "executed";
export interface AuditEvent {
    subjects: readonly Subject[];
    action: string;
    resource: string;
    decision: AuditDecision;
    source: string;
    detail: Record<string, unknown> | null;
}
export interface AuditSink {
    record(event: AuditEvent): void;
}
export interface SubjectDirectory {
    exists(subject: Subject): Promise<boolean>;
}
//# sourceMappingURL=index.d.ts.map