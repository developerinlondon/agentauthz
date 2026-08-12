// Action derivation: a host declares that one action derives from another, so
// a statement naming a coarse action covers a declared family of finer ones.
// Not a wildcard — the expansion is closed and enumerable, and every member
// still passes the registry. Derivation is registry data, never policy data.
// Reachable only via a hand-rolled lookup; catalogues reject cycles at build.
export const MAX_DERIVATION_DEPTH = 64;
// Walks upward from the REQUESTED action: statements name the base, checks
// name the leaf. Without a lookup this is exact equality.
export function matchAction(pattern, requested, parentOf) {
    if (pattern === requested)
        return "match";
    if (!parentOf)
        return "no-match";
    const seen = new Set([requested]);
    let current = parentOf(requested);
    for (let depth = 0; current !== undefined; depth++) {
        if (typeof current !== "string" || current.length === 0)
            return "no-match";
        if (current === pattern)
            return "match";
        if (seen.has(current) || depth >= MAX_DERIVATION_DEPTH)
            return "unresolvable";
        seen.add(current);
        current = parentOf(current);
    }
    return "no-match";
}
// Empty when the chain cannot be resolved, so a "why" view reads it as
// unknown rather than as an absence of ancestry.
export function actionAncestry(requested, parentOf) {
    const chain = [requested];
    if (!parentOf)
        return chain;
    const seen = new Set([requested]);
    let current = parentOf(requested);
    for (let depth = 0; current !== undefined; depth++) {
        if (typeof current !== "string" || current.length === 0)
            break;
        if (seen.has(current) || depth >= MAX_DERIVATION_DEPTH)
            return [];
        seen.add(current);
        chain.push(current);
        current = parentOf(current);
    }
    return chain;
}
export class ActionCatalogueError extends Error {
}
// Throws rather than degrading: a malformed vocabulary is a host bug at boot,
// and the engine must never hold a graph it cannot enumerate.
export function indexActionCatalogue(entries) {
    const actions = new Set();
    for (const e of entries) {
        if (!e || typeof e.action !== "string" || e.action.length === 0) {
            throw new ActionCatalogueError("catalogue entry has no action");
        }
        if (e.action.includes("*")) {
            throw new ActionCatalogueError(`action "${e.action}" contains a wildcard`);
        }
        if (actions.has(e.action)) {
            throw new ActionCatalogueError(`action "${e.action}" declared twice`);
        }
        actions.add(e.action);
    }
    const parents = new Map();
    const children = new Map();
    for (const e of entries) {
        if (e.derivesFrom === undefined)
            continue;
        if (!actions.has(e.derivesFrom)) {
            throw new ActionCatalogueError(`action "${e.action}" derives from unknown action "${e.derivesFrom}"`);
        }
        if (e.derivesFrom === e.action) {
            throw new ActionCatalogueError(`action "${e.action}" derives from itself`);
        }
        parents.set(e.action, e.derivesFrom);
        children.set(e.derivesFrom, [...(children.get(e.derivesFrom) ?? []), e.action]);
    }
    for (const start of parents.keys()) {
        const seen = new Set([start]);
        let current = parents.get(start);
        while (current !== undefined) {
            if (seen.has(current)) {
                throw new ActionCatalogueError(`derivation cycle through action "${current}"`);
            }
            seen.add(current);
            current = parents.get(current);
        }
    }
    return { parents, children, actions };
}
// The enumerability that separates a derivation from a wildcard.
export function collectDescendants(children, base) {
    const out = new Set();
    const queue = [...(children.get(base) ?? [])];
    while (queue.length > 0) {
        const next = queue.shift();
        if (out.has(next))
            continue;
        out.add(next);
        queue.push(...(children.get(next) ?? []));
    }
    return [...out].sort();
}
//# sourceMappingURL=action.js.map