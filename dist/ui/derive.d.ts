import type { PolicyCondition } from "../model/condition.js";
import type { AuthzDescriptor, DescribedConditionKey } from "../model/descriptor.js";
export type ControlKind = "text" | "number" | "datetime" | "cidr" | "multi";
export interface BoundField {
    key: string;
    spec: DescribedConditionKey;
    selectable: boolean;
}
export declare function boundFields(descriptor: AuthzDescriptor): BoundField[];
export declare function controlFor(spec: DescribedConditionKey, operator: string, setOperators: readonly string[]): ControlKind;
export interface DraftBound {
    key: string;
    operator: string;
    value: string;
    values: string[];
}
export declare function toCondition(draft: DraftBound, setOperators: readonly string[]): PolicyCondition;
export interface Coverage {
    granted: string[];
    excluded: string[];
}
export declare function coverageOf(descriptor: AuthzDescriptor, statements: ReadonlyArray<{
    effect: string;
    actions: string[];
}>): Coverage;
export declare class UnsupportedDescriptorError extends Error {
}
export declare function assertSupported(descriptor: AuthzDescriptor, supported: number): void;
//# sourceMappingURL=derive.d.ts.map