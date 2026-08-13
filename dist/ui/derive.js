// The descriptor -> form derivation, kept pure and free of React so the claim
// "adding a condition key server-side produces a new field with no frontend
// change" is directly testable.
export function boundFields(descriptor) {
    return Object.entries(descriptor.conditionKeys).map(([key, spec]) => ({
        key,
        spec,
        selectable: spec.builtIn !== true,
    }));
}
// A set operator takes a list whatever the key's type, so the operator decides
// the control before the type does.
export function controlFor(spec, operator, setOperators) {
    if (setOperators.includes(operator))
        return "multi";
    switch (spec.type) {
        case "number":
            return "number";
        case "date":
            return "datetime";
        case "ip":
            return "cidr";
        default:
            return "text";
    }
}
// A scalar operator emits `value`, a set operator emits `values` — never both,
// which the engine reads as an unmatchable condition.
export function toCondition(draft, setOperators) {
    return setOperators.includes(draft.operator)
        ? { operator: draft.operator, key: draft.key, values: draft.values.filter((v) => v.length > 0) }
        : { operator: draft.operator, key: draft.key, value: draft.value };
}
// What a policy's allow statements actually confer, expanded through the
// derivation closure — the difference between "granted content-author" and
// four named actions a reviewer can check.
export function coverageOf(descriptor, statements) {
    const expand = (names) => {
        const out = new Set();
        for (const a of names) {
            out.add(a);
            for (const d of descriptor.actionClosures[a] ?? [])
                out.add(d);
        }
        return out;
    };
    const granted = expand(statements.filter((s) => s.effect === "allow").flatMap((s) => s.actions));
    const excluded = expand(statements.filter((s) => s.effect === "deny").flatMap((s) => s.actions));
    for (const a of excluded)
        granted.delete(a);
    return { granted: [...granted].sort(), excluded: [...excluded].sort() };
}
export class UnsupportedDescriptorError extends Error {
}
// Refuse a document this build does not understand rather than render a
// half-correct form against it.
export function assertSupported(descriptor, supported) {
    if (descriptor.version !== supported) {
        throw new UnsupportedDescriptorError(`this admin UI understands descriptor version ${supported}, `
            + `but the server serves version ${String(descriptor.version)}`);
    }
}
//# sourceMappingURL=derive.js.map