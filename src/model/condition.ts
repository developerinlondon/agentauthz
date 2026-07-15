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
] as const;
export type ConditionOperator = typeof CONDITION_OPERATORS[number];

export type ConditionKeyType = "string" | "number" | "date" | "ip";

export const OPERATOR_KEY_TYPE: Record<ConditionOperator, ConditionKeyType> = {
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

// A host-declared condition key: its context-value type, and whether stored
// and compared values are lowercased (for keys whose context value is
// normalized to lowercase — e.g. a caller-email key — so a mixed-case authored
// value can never fail OPEN by comparing case-sensitively).
export interface ConditionKeySpec {
  type: ConditionKeyType;
  lowercase?: boolean;
}

// key → spec. A closed record: adding a key REQUIRES stating its type.
export type ConditionKeys = Record<string, ConditionKeySpec>;

export interface PolicyCondition {
  operator: string;
  key: string;
  value: string;
}

// The attribute bag conditions test — build it ONLY via
// core/conditions.ts makeConditionContext (null-prototype) from real check
// inputs, never from caller-supplied objects. A multi-valued key (e.g. a
// roles key) carries string[]; every other key is a scalar.
export type ConditionContext = Record<string, string | number | string[]>;
