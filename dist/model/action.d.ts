export type ActionParentLookup = (action: string) => string | undefined;
export declare const MAX_DERIVATION_DEPTH = 64;
export type ActionMatch = "match" | "no-match" | "unresolvable";
export declare function matchAction(
  pattern: string,
  requested: string,
  parentOf?: ActionParentLookup,
): ActionMatch;
export declare function actionAncestry(requested: string, parentOf?: ActionParentLookup): string[];
export interface ActionCatalogueEntry {
  action: string;
  derivesFrom?: string;
}
export declare class ActionCatalogueError extends Error {
}
export declare function indexActionCatalogue(entries: readonly ActionCatalogueEntry[]): {
  parents: Map<string, string>;
  children: Map<string, string[]>;
  actions: Set<string>;
};
export declare function collectDescendants(
  children: ReadonlyMap<string, readonly string[]>,
  base: string,
): string[];
// # sourceMappingURL=action.d.ts.map
