// Subjects are explicit {kind, id} pairs; kinds are host-declared strings.
// The library stores no principals — grants hold references, and a dangling
// reference never matches anything. Identity resolution (and any id
// normalization, e.g. lowercasing emails) is entirely the host's problem and
// must happen before subjects reach the engine.

export interface Subject {
  kind: string;
  id: string;
}

export function isValidSubject(subject: unknown): subject is Subject {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return false;
  const s = subject as Record<string, unknown>;
  return typeof s.kind === "string" && s.kind.length > 0
    && typeof s.id === "string" && s.id.length > 0;
}

export function subjectEquals(a: Subject, b: Subject): boolean {
  return a.kind === b.kind && a.id === b.id;
}
