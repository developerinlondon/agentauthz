import { type PolicyStatement } from "../model/statement.js";
import type { ValidationVocabulary } from "./validate.js";
export interface DraftVocabulary extends ValidationVocabulary {
  isKnownResource?: (resource: string) => boolean;
}
export interface DraftResult {
  ok: boolean;
  name: string;
  description: string | null;
  statements: PolicyStatement[];
  warnings: string[];
  error?: string;
}
export declare function repairDraft(raw: unknown, vocabulary: DraftVocabulary): DraftResult;
// # sourceMappingURL=repair.d.ts.map
