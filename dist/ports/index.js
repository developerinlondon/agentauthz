// The seams a host (or storage backend) plugs into the engine. Core depends
// only on these interfaces; backends/pg is the reference implementation, and
// any alternative backend must be decision-identical (the conformance/
// fixtures are the contract).
import { collectDescendants, indexActionCatalogue, } from "../model/action.js";
export function actionRegistryFromList(actions) {
    const set = new Set(actions);
    return {
        isKnownAction: (action) => set.has(action),
        listActions: () => [...set],
    };
}
// Builds a registry from a declared catalogue, validating that every parent is
// itself declared and that the graph is acyclic. Throws on a bad vocabulary.
export function actionRegistryFromCatalogue(entries) {
    const { parents, children, actions } = indexActionCatalogue(entries);
    return {
        isKnownAction: (action) => actions.has(action),
        parentOf: (action) => parents.get(action),
        descendantsOf: (action) => collectDescendants(children, action),
        listActions: () => [...actions],
    };
}
//# sourceMappingURL=index.js.map