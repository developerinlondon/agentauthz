// Scopes are {kind, id} positions in a host-declared hierarchy. A check is
// evaluated against an ordered, HOST-RESOLVED scope chain (root first): every
// grant at any scope in the chain applies, so a root grant is inherited at
// every depth while a leaf grant never applies anywhere but that leaf. The
// engine never resolves parentage itself — the host resolves the chain, and a
// malformed or undeclared entry DENIES (fail closed), never silently
// evaluates a different chain than the caller named.

export interface Scope {
  kind: string;
  id: string;
}

export type ScopeChain = readonly Scope[];

export function isValidScope(scope: unknown): scope is Scope {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return false;
  const s = scope as Record<string, unknown>;
  return typeof s.kind === "string" && s.kind.length > 0
    && typeof s.id === "string" && s.id.length > 0;
}

export function scopeEquals(a: Scope, b: Scope): boolean {
  return a.kind === b.kind && a.id === b.id;
}
