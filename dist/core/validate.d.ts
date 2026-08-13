import type { ConditionKeys } from "../model/condition.js";
import { type PolicyStatement } from "../model/statement.js";
export type Validation = {
    ok: true;
    statements: PolicyStatement[];
} | {
    ok: false;
    error: string;
};
export interface ValidationVocabulary {
    isKnownAction: (action: string) => boolean;
    conditionKeys: ConditionKeys;
}
export declare function validateStatements(input: unknown, vocabulary: ValidationVocabulary): Validation;
//# sourceMappingURL=validate.d.ts.map