import type { ConditionContext, ConditionKeys } from "../model/condition.js";
import type { ResolvedGrant } from "../model/grant.js";
import { type ScopeChain } from "../model/scope.js";
import { type Subject } from "../model/subject.js";
export declare function decide(grants: readonly ResolvedGrant[], action: string, resource: string, ctx: ConditionContext, keys: ConditionKeys): "allow" | "deny";
export declare function applicableGrants(grants: readonly ResolvedGrant[], subjects: readonly Subject[], scopeChain: ScopeChain): ResolvedGrant[];
export interface EvaluateInput {
    grants: readonly ResolvedGrant[];
    subjects: readonly Subject[];
    action: string;
    resource: string;
    scopeChain: ScopeChain;
    context: ConditionContext;
    conditionKeys: ConditionKeys;
    scopeKinds?: readonly string[];
}
export declare function evaluate(input: EvaluateInput): "allow" | "deny";
//# sourceMappingURL=evaluate.d.ts.map