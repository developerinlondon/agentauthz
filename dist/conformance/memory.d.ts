import type { GrantBounds, ResolvedGrant } from "../model/grant.js";
import type { Scope, ScopeChain } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import type { GrantSource, GrantStore } from "../ports/index.js";
export declare function memoryGrantSource(grants: readonly ResolvedGrant[]): GrantSource;
export interface MemoryPolicy {
    id: string;
    name: string;
    statements: ResolvedGrant["statements"];
}
export declare class MemoryGrantStore implements GrantStore {
    private readonly rootScope?;
    private readonly grants;
    private readonly policies;
    private nextId;
    constructor(rootScope?: Scope | undefined);
    addPolicy(policy: MemoryPolicy): void;
    seed(grant: ResolvedGrant): void;
    grantsFor(subjects: readonly Subject[], scopeChain: ScopeChain): Promise<ResolvedGrant[]>;
    createGrant(input: {
        policyId: string;
        subject: Subject;
        scope: Scope;
        bounds?: GrantBounds;
        createdBy: string | null;
    }): Promise<void>;
    deleteGrant(id: string): Promise<boolean>;
    deleteGrantsForSubject(subject: Subject): Promise<number>;
    deleteGrantsForPolicy(policyId: string): Promise<number>;
    private remove;
}
//# sourceMappingURL=memory.d.ts.map