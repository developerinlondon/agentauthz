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
    NumericLessThan: "number",
    NumericGreaterThan: "number",
    DateLessThan: "date",
    DateGreaterThan: "date",
    IpAddress: "ip",
    NotIpAddress: "ip",
};
//# sourceMappingURL=condition.js.map