import {
  type ConditionContext,
  type ConditionKeys,
  type PolicyCondition,
} from "../model/condition.js";
export declare const BUILTIN_CONDITION_KEYS: ConditionKeys;
export declare function resolveConditionKeys(hostKeys?: ConditionKeys): ConditionKeys;
export declare function makeConditionContext(
  entries?: Record<string, string | number | string[]>,
): ConditionContext;
export declare function builtinContextEntries(opts?: {
  now?: Date;
  sourceIp?: string | null;
}): {
  "request:Time": string;
  "request:HourUTC": number;
  "request:SourceIp"?: string;
};
export type ConditionsVerdict = "match" | "no-match" | "unmatchable";
export declare function evalConditions(
  conditions: unknown,
  ctx: ConditionContext,
  keys: ConditionKeys,
): ConditionsVerdict;
export type ConditionsValidation = {
  ok: true;
  conditions: PolicyCondition[];
} | {
  ok: false;
  error: string;
};
export declare function validateConditions(
  input: unknown,
  keys: ConditionKeys,
): ConditionsValidation;
// # sourceMappingURL=conditions.d.ts.map
