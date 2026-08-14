export declare const CONDITION_OPERATORS: readonly ["StringEquals", "StringNotEquals", "StringLike", "StringIn", "StringNotIn", "StringLikeIn", "NumericLessThan", "NumericGreaterThan", "DateLessThan", "DateGreaterThan", "IpAddress", "NotIpAddress"];
export type ConditionOperator = typeof CONDITION_OPERATORS[number];
export type ConditionKeyType = "string" | "number" | "date" | "ip";
export declare const OPERATOR_KEY_TYPE: Record<ConditionOperator, ConditionKeyType>;
export interface ConditionKeySpec {
    type: ConditionKeyType;
    lowercase?: boolean;
    title?: string;
    description?: string;
}
export type ConditionKeys = Record<string, ConditionKeySpec>;
export interface PolicyCondition {
    operator: string;
    key: string;
    value?: string;
    values?: string[];
}
export declare const SET_OPERATORS: readonly ["StringIn", "StringNotIn", "StringLikeIn"];
export declare function isSetOperator(operator: string): boolean;
export type ConditionContext = Record<string, string | number | string[]>;
//# sourceMappingURL=condition.d.ts.map