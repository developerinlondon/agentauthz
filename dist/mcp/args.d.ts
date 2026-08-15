import { type Scope, type ScopeChain } from "../model/scope.js";
import { type Subject } from "../model/subject.js";
export declare function toolArgs(args: unknown): Record<string, unknown>;
export declare function requiredString(args: Record<string, unknown>, name: string): string;
export declare function optionalString(args: Record<string, unknown>, name: string): string | undefined;
export declare function optionalNumber(args: Record<string, unknown>, name: string): number | undefined;
export declare function requiredSubject(args: Record<string, unknown>, name: string): Subject;
export declare function requiredScope(args: Record<string, unknown>, name: string): Scope;
export declare function requiredSubjects(args: Record<string, unknown>, name: string): Subject[];
export declare function optionalScopeChain(args: Record<string, unknown>, name: string): ScopeChain | undefined;
export declare function optionalContext(args: Record<string, unknown>, name: string): Record<string, string | number | string[]> | undefined;
//# sourceMappingURL=args.d.ts.map