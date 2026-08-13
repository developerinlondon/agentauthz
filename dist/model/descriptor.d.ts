import type { ConditionKeyType, ConditionOperator } from "./condition.js";
export declare const DESCRIPTOR_VERSION = 1;
export interface DescribedAction {
    action: string;
    derivesFrom?: string;
}
export interface DescribedConditionKey {
    type: ConditionKeyType;
    lowercase?: true;
    builtIn?: true;
    operators: ConditionOperator[];
}
export interface AuthzDescriptor {
    version: typeof DESCRIPTOR_VERSION;
    actions: DescribedAction[];
    actionClosures: Record<string, string[]>;
    conditionKeys: Record<string, DescribedConditionKey>;
    scopeKinds: string[];
    setOperators: ConditionOperator[];
}
//# sourceMappingURL=descriptor.d.ts.map