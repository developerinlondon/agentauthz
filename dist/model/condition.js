// Condition shapes and whitelists. The operator table and its semantics are
// documented in the README under "Conditions"; what follows is the closed set
// the engine will accept — a condition is never free expression code.
export const CONDITION_OPERATORS = [
    "StringEquals",
    "StringNotEquals",
    "StringLike",
    // Set membership, taking `values` instead of `value` — an allowlist is one
    // condition rather than one statement per permitted value.
    "StringIn",
    "StringNotIn",
    "StringLikeIn",
    "NumericLessThan",
    "NumericGreaterThan",
    "DateLessThan",
    "DateGreaterThan",
    // CIDR membership (IPv4 + IPv6), on `ip`-typed keys only.
    "IpAddress",
    "NotIpAddress",
];
export const OPERATOR_KEY_TYPE = {
    StringEquals: "string",
    StringNotEquals: "string",
    StringLike: "string",
    StringIn: "string",
    StringNotIn: "string",
    StringLikeIn: "string",
    NumericLessThan: "number",
    NumericGreaterThan: "number",
    DateLessThan: "date",
    DateGreaterThan: "date",
    IpAddress: "ip",
    NotIpAddress: "ip",
};
// Operators whose bound is a list. Kept beside CONDITION_OPERATORS so adding
// an operator cannot silently miss the set/scalar split.
export const SET_OPERATORS = ["StringIn", "StringNotIn", "StringLikeIn"];
export function isSetOperator(operator) {
    return SET_OPERATORS.includes(operator);
}
//# sourceMappingURL=condition.js.map