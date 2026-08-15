// Tool input schemas are GENERATED from the descriptor, never authored. A host
// that declares one more condition key, action or scope kind gets a tool whose
// input schema already knows about it — the model is told the vocabulary in
// the only place it reads, and nothing here needs editing.
const NON_EMPTY_STRING = { type: "string", minLength: 1 };
export const SUBJECT_SCHEMA = {
    type: "object",
    required: ["kind", "id"],
    properties: { kind: NON_EMPTY_STRING, id: NON_EMPTY_STRING },
    additionalProperties: false,
};
// Declared scope kinds close the field; a host that declares none leaves it
// open rather than pretending the set is empty.
export function scopeSchema(descriptor) {
    const kind = descriptor.scopeKinds.length > 0
        ? { type: "string", enum: [...descriptor.scopeKinds] }
        : NON_EMPTY_STRING;
    return {
        type: "object",
        required: ["kind", "id"],
        properties: { kind, id: NON_EMPTY_STRING },
        additionalProperties: false,
    };
}
export function actionSchema(descriptor) {
    const names = descriptor.actions.map((a) => a.action);
    return names.length > 0
        ? { type: "string", enum: names, description: "One of this host's declared actions." }
        : NON_EMPTY_STRING;
}
function keyNote(spec) {
    const parts = [spec.title, spec.description];
    if (spec.lowercase)
        parts.push("Compared lowercased on both sides.");
    const note = parts.filter((p) => p !== undefined && p.length > 0).join(" — ");
    return note.length > 0 ? note : undefined;
}
function described(spec, schema) {
    const note = keyNote(spec);
    return note === undefined ? schema : { ...schema, description: note };
}
// What a BOUND on a key of this type may carry. A numeric bound authored as a
// JSON number is accepted (validateConditions normalizes it) rather than
// bouncing a model into quoting a number it already has.
function boundValueSchema(type) {
    switch (type) {
        case "number":
            return { type: ["string", "number"] };
        case "date":
            return {
                type: "string",
                format: "date-time",
                description: "RFC 3339 with an explicit timezone (Z or ±HH:MM).",
            };
        case "ip":
            return {
                type: "string",
                description: "IPv4 or IPv6 CIDR, e.g. 10.0.0.0/8 or 2001:db8::/32.",
            };
        default:
            return NON_EMPTY_STRING;
    }
}
// What the CONTEXT may carry for a key of this type. A string key may hold
// several values at once (a principal with several roles); the rest are
// scalars.
function contextValueSchema(type) {
    switch (type) {
        case "number":
            return { type: "number" };
        case "date":
            return { type: "string", format: "date-time" };
        case "ip":
            return { type: "string" };
        default:
            return { type: ["string", "array"], items: { type: "string" } };
    }
}
// One branch per declared key: its own `key` constant, only the operators its
// type admits, and a value typed to match. Set operators take `values` and
// scalar operators take `value`, so each key contributes at most two branches
// and a model cannot assemble the illegal cross-product.
function boundBranches(descriptor) {
    const setOperators = new Set(descriptor.setOperators);
    const branches = [];
    for (const [key, spec] of Object.entries(descriptor.conditionKeys)) {
        const scalar = spec.operators.filter((op) => !setOperators.has(op));
        const set = spec.operators.filter((op) => setOperators.has(op));
        if (scalar.length > 0) {
            branches.push(described(spec, {
                title: key,
                type: "object",
                required: ["key", "operator", "value"],
                properties: {
                    key: { const: key },
                    operator: { type: "string", enum: scalar },
                    value: boundValueSchema(spec.type),
                },
                additionalProperties: false,
            }));
        }
        if (set.length > 0) {
            branches.push(described(spec, {
                title: `${key} (set membership)`,
                type: "object",
                required: ["key", "operator", "values"],
                properties: {
                    key: { const: key },
                    operator: { type: "string", enum: set },
                    values: { type: "array", minItems: 1, items: NON_EMPTY_STRING },
                },
                additionalProperties: false,
            }));
        }
    }
    return branches;
}
export function boundsSchema(descriptor) {
    const branches = boundBranches(descriptor);
    const description = "Conditions carried by the grant, narrowing the policy's allow statements "
        + "for this subject only.";
    // A vocabulary with no keys admits no bound. An empty `anyOf` is not a
    // schema, so say "no items are legal" outright.
    if (branches.length === 0) {
        return {
            type: "array",
            maxItems: 0,
            description: `${description} This host declares no condition keys.`,
        };
    }
    return { type: "array", description, items: { anyOf: branches } };
}
// Host-declared keys only. The built-in request:* keys are populated by the
// engine from the real check inputs and would be overwritten, so offering them
// here would invite a model to supply a value that is silently discarded.
export function contextSchema(descriptor) {
    const properties = {};
    for (const [key, spec] of Object.entries(descriptor.conditionKeys)) {
        if (spec.builtIn)
            continue;
        properties[key] = described(spec, contextValueSchema(spec.type));
    }
    if (Object.keys(properties).length === 0)
        return undefined;
    return {
        type: "object",
        properties,
        additionalProperties: false,
        description: "Values for this host's declared condition keys. Omit any key with no honest "
            + "value — a condition on an unpopulated key fails closed.",
    };
}
//# sourceMappingURL=schema.js.map