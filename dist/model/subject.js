// Subjects are explicit {kind, id} pairs; kinds are host-declared strings.
// The library stores no principals — grants hold references, and a dangling
// reference never matches anything. Identity resolution (and any id
// normalization, e.g. lowercasing emails) is entirely the host's problem and
// must happen before subjects reach the engine.
export function isValidSubject(subject) {
    if (!subject || typeof subject !== "object" || Array.isArray(subject))
        return false;
    const s = subject;
    return typeof s.kind === "string" && s.kind.length > 0
        && typeof s.id === "string" && s.id.length > 0;
}
export function subjectEquals(a, b) {
    return a.kind === b.kind && a.id === b.id;
}
//# sourceMappingURL=subject.js.map