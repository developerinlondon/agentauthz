// Policy statements — THE SPEC. A statement is {effect, actions, resources,
// conditions?}: actions are drawn from a closed, host-declared registry and
// NEVER carry wildcards; resources are opaque strings matched exactly or via a
// single trailing `*` (a prefix wildcard); conditions are typed {operator,
// key, value} narrowings (see model/condition.ts) evaluated fail-closed by
// the core engine. These rules fail closed at policy-save time
// (core/validate.ts validateStatements) so a bad document can never widen
// authority silently.
// A statement action is valid iff the host-declared registry knows it. Any `*`
// disqualifies it — actions never carry wildcards (resources do, see below).
export function isValidAction(action, isKnownAction) {
    if (action.includes("*"))
        return false;
    return isKnownAction(action);
}
// A resource pattern is valid iff it's a non-empty string with at most one `*`,
// and only as the final character (exact match, or a trailing-`*` prefix).
export function isValidResource(resource) {
    if (resource.length === 0)
        return false;
    const star = resource.indexOf("*");
    return star === -1 || star === resource.length - 1;
}
// Requested action ⟷ statement action: exact equality (no wildcards on actions).
export function actionMatches(pattern, requested) {
    return pattern === requested;
}
// Requested resource ⟷ statement resource: exact, or trailing-`*` prefix match.
export function resourceMatches(pattern, requested) {
    if (pattern.endsWith("*"))
        return requested.startsWith(pattern.slice(0, -1));
    return pattern === requested;
}
//# sourceMappingURL=statement.js.map