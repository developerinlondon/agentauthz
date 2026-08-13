import { type ConditionKeys } from "../model/condition.js";
import { type AuthzDescriptor } from "../model/descriptor.js";
import type { ActionRegistry } from "../ports/index.js";
export interface DescribeInput {
  actionRegistry?: ActionRegistry;
  conditionKeys?: ConditionKeys;
  scopeKinds?: readonly string[];
}
export declare function describeAuthz(input?: DescribeInput): AuthzDescriptor;
// # sourceMappingURL=describe.d.ts.map
