export declare const CONDITION_OPERATORS: readonly ["StringEquals", "StringNotEquals", "StringLike", "NumericLessThan", "NumericGreaterThan", "DateLessThan", "DateGreaterThan", "IpAddress", "NotIpAddress"];
export type ConditionOperator = typeof CONDITION_OPERATORS[number];
export type ConditionKeyType = "string" | "number" | "date" | "ip";
export declare const OPERATOR_KEY_TYPE: Record<ConditionOperator, ConditionKeyType>;
export interface ConditionKeySpec {
    type: ConditionKeyType;
    lowercase?: boolean;
}
export type ConditionKeys = Record<string, ConditionKeySpec>;
export interface PolicyCondition {
    operator: string;
    key: string;
    value: string;
}
export type ConditionContext = Record<string, string | number | string[]>;
//# sourceMappingURL=condition.d.ts.map