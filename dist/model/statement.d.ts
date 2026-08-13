import type { PolicyCondition } from "./condition.js";
export type Effect = "allow" | "deny";
export interface PolicyStatement {
    effect: Effect;
    actions: string[];
    resources: string[];
    conditions?: PolicyCondition[];
}
export declare function isValidAction(action: string, isKnownAction: (action: string) => boolean): boolean;
export declare function isValidResource(resource: string): boolean;
export declare function actionMatches(pattern: string, requested: string): boolean;
export declare function resourceMatches(pattern: string, requested: string): boolean;
//# sourceMappingURL=statement.d.ts.map