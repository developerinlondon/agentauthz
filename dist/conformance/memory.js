import { applicableGrants } from "../core/evaluate.js";
import { scopeEquals } from "../model/scope.js";
import { subjectEquals } from "../model/subject.js";
// The in-memory reference GrantStore: the executable definition of the
// GrantSource contract (grantsFor returns EXACTLY the grants matching
// subjects × scopeChain, via the same filter the pure evaluator uses). The
// conformance runner builds engines on it; hosts can use it in tests.
export function memoryGrantSource(grants) {
    return {
        grantsFor: (subjects, scopeChain) => Promise.resolve(applicableGrants(grants, subjects, scopeChain)),
    };
}
export class MemoryGrantStore {
    rootScope;
    grants = [];
    policies = new Map();
    nextId = 1;
    constructor(rootScope) {
        this.rootScope = rootScope;
    }
    addPolicy(policy) {
        this.policies.set(policy.id, policy);
    }
    // Pre-resolved seeding (conformance fixtures carry statements inline).
    seed(grant) {
        this.policies.set(grant.policyId, {
            id: grant.policyId,
            name: grant.policyName,
            statements: grant.statements,
        });
        this.grants.push({
            id: `g${this.nextId++}`,
            policyId: grant.policyId,
            policyName: grant.policyName,
            subject: grant.subject,
            scope: grant.scope,
            createdBy: null,
            createdAt: new Date(0).toISOString(),
            statements: grant.statements,
        });
    }
    async grantsFor(subjects, scopeChain) {
        return applicableGrants(this.grants, subjects, scopeChain).map((g) => ({
            policyId: g.policyId,
            policyName: g.policyName,
            subject: g.subject,
            scope: g.scope,
            statements: g.statements,
        }));
    }
    // Idempotent, root-id-normalizing — the same contract as the pg backend.
    async createGrant(input) {
        const policy = this.policies.get(input.policyId);
        if (!policy)
            throw new Error(`unknown policy ${input.policyId}`);
        const scope = this.rootScope && input.scope.kind === this.rootScope.kind
            ? this.rootScope
            : input.scope;
        if (this.grants.some((g) => g.policyId === input.policyId
            && subjectEquals(g.subject, input.subject)
            && scopeEquals(g.scope, scope))) {
            return;
        }
        this.grants.push({
            id: `g${this.nextId++}`,
            policyId: policy.id,
            policyName: policy.name,
            subject: input.subject,
            scope,
            createdBy: input.createdBy,
            createdAt: new Date().toISOString(),
            statements: policy.statements,
        });
    }
    async deleteGrant(id) {
        const i = this.grants.findIndex((g) => g.id === id);
        if (i === -1)
            return false;
        this.grants.splice(i, 1);
        return true;
    }
    async deleteGrantsForSubject(subject) {
        return this.remove((g) => subjectEquals(g.subject, subject));
    }
    async deleteGrantsForPolicy(policyId) {
        return this.remove((g) => g.policyId === policyId);
    }
    remove(match) {
        const before = this.grants.length;
        for (let i = this.grants.length - 1; i >= 0; i--) {
            if (match(this.grants[i]))
                this.grants.splice(i, 1);
        }
        return before - this.grants.length;
    }
}
//# sourceMappingURL=memory.js.map