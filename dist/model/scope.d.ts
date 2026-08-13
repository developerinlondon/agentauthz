export interface Scope {
    kind: string;
    id: string;
}
export type ScopeChain = readonly Scope[];
export declare function isValidScope(scope: unknown): scope is Scope;
export declare function scopeEquals(a: Scope, b: Scope): boolean;
//# sourceMappingURL=scope.d.ts.map