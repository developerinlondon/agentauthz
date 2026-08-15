import { CONDITION_OPERATORS, OPERATOR_KEY_TYPE, SET_OPERATORS, } from "../model/condition.js";
import { DESCRIPTOR_VERSION, } from "../model/descriptor.js";
import { BUILTIN_CONDITION_KEYS, resolveConditionKeys } from "./conditions.js";
function operatorsFor(type) {
    return CONDITION_OPERATORS.filter((op) => OPERATOR_KEY_TYPE[op] === type);
}
// A projection of the declared vocabulary, holding no state of its own. A
// registry that cannot enumerate its actions degrades to an empty catalogue
// rather than throwing: grants and audit remain administrable without one.
export function describeAuthz(input = {}) {
    const registry = input.actionRegistry;
    const names = registry?.listActions?.() ?? [];
    const actions = names.map((action) => {
        const parent = registry?.parentOf?.(action);
        const notes = registry?.annotationsOf?.(action);
        return {
            action,
            ...(parent === undefined ? {} : { derivesFrom: parent }),
            ...(notes?.title === undefined ? {} : { title: notes.title }),
            ...(notes?.description === undefined ? {} : { description: notes.description }),
        };
    });
    const actionClosures = Object.create(null);
    const descendantsOf = registry?.descendantsOf;
    if (descendantsOf) {
        for (const action of names)
            actionClosures[action] = descendantsOf.call(registry, action);
    }
    const conditionKeys = Object.create(null);
    for (const [key, spec] of Object.entries(resolveConditionKeys(input.conditionKeys))) {
        conditionKeys[key] = {
            type: spec.type,
            ...(spec.lowercase === true ? { lowercase: true } : {}),
            ...(Object.hasOwn(BUILTIN_CONDITION_KEYS, key) ? { builtIn: true } : {}),
            operators: operatorsFor(spec.type),
            ...(spec.title === undefined ? {} : { title: spec.title }),
            ...(spec.description === undefined ? {} : { description: spec.description }),
        };
    }
    return {
        version: DESCRIPTOR_VERSION,
        actions,
        actionClosures,
        conditionKeys,
        scopeKinds: [...(input.scopeKinds ?? [])],
        setOperators: [...SET_OPERATORS],
    };
}
// The projection back: a descriptor already carries each key's type and
// lowercase flag, which is exactly ConditionKeys. An administrative surface
// validating a bound therefore uses the same vocabulary its consumer was told
// about, and the two cannot disagree about what is legal.
export function conditionKeysFromDescriptor(descriptor) {
    const keys = Object.create(null);
    for (const [key, spec] of Object.entries(descriptor.conditionKeys)) {
        keys[key] = { type: spec.type, ...(spec.lowercase ? { lowercase: true } : {}) };
    }
    return resolveConditionKeys(keys);
}
//# sourceMappingURL=describe.js.map