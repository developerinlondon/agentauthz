// The seams a host (or storage backend) plugs into the engine. Core depends
// only on these interfaces; backends/pg is the reference implementation, and
// any alternative backend must be decision-identical (the conformance/
// fixtures are the contract).
export function actionRegistryFromList(actions) {
    const set = new Set(actions);
    return { isKnownAction: (action) => set.has(action) };
}
//# sourceMappingURL=index.js.map