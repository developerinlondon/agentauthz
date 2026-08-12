import type { ConditionKeys } from "../model/condition.js";
import type { ResolvedGrant } from "../model/grant.js";
import type { Scope } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
export { memoryGrantSource, MemoryGrantStore } from "./memory.js";
export interface ConformanceCase {
    suite: string;
    name: string;
    conditionKeys: ConditionKeys;
    scopeKinds: string[];
    grants: ResolvedGrant[];
    synthesizedGrants: ResolvedGrant[];
    check: {
        subjects: Subject[];
        action: string;
        resource: string;
        scopeChain: Scope[];
        context: Record<string, string | number | string[]>;
        sourceIp?: string;
        now?: string;
    };
    expect: "allow" | "deny";
    storable: boolean;
}
export declare function loadConformanceCases(): ConformanceCase[];
export type ConformanceImpl = (c: ConformanceCase) => Promise<"allow" | "deny">;
export declare const pureEvaluatorImpl: ConformanceImpl;
export declare const composedEngineImpl: ConformanceImpl;
export interface ConformanceResult {
    case: ConformanceCase;
    expected: "allow" | "deny";
    actual: "allow" | "deny";
    pass: boolean;
}
export declare function runConformance(impl: ConformanceImpl): Promise<ConformanceResult[]>;
//# sourceMappingURL=index.d.ts.map