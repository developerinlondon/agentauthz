// Condition shapes and whitelists — THE SPEC. A condition is {operator, key,
// value} — NEVER free expression code — where the operator comes from
// CONDITION_OPERATORS (closed here) and the key from the host-declared
// ConditionKeys merged with the built-in request:* keys (core/conditions.ts).
// Each key declares the type its context value carries, which fixes the
// operator family allowed on it.
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