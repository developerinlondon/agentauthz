import { describe, expect, test } from "bun:test";
import {
  actionAncestry,
  ActionCatalogueError,
  indexActionCatalogue,
  matchAction,
  MAX_DERIVATION_DEPTH,
} from "../src/model/action.js";
import { actionRegistryFromCatalogue, actionRegistryFromList } from "../src/ports/index.js";

const CATALOGUE = [
  { action: "edit" },
  { action: "read" },
  { action: "docs.update", derivesFrom: "edit" },
  { action: "docs.delete", derivesFrom: "docs.update" },
  { action: "docs.read", derivesFrom: "read" },
];

describe("matchAction", () => {
  const parentOf = (a: string) => ({ "docs.update": "edit", "docs.delete": "docs.update" }[a]);

  test("without a lookup it is exact equality — existing policies are unaffected", () => {
    expect(matchAction("edit", "edit")).toBe("match");
    expect(matchAction("edit", "docs.update")).toBe("no-match");
  });

  test("a base matches an action deriving from it, transitively", () => {
    expect(matchAction("edit", "docs.update", parentOf)).toBe("match");
    expect(matchAction("edit", "docs.delete", parentOf)).toBe("match");
    expect(matchAction("docs.update", "docs.delete", parentOf)).toBe("match");
  });

  test("it never runs downward or sideways", () => {
    expect(matchAction("docs.delete", "edit", parentOf)).toBe("no-match");
    expect(matchAction("docs.update", "docs.read", parentOf)).toBe("no-match");
    expect(matchAction("read", "docs.update", parentOf)).toBe("no-match");
  });

  test("a cycle reports unresolvable rather than looping or reading as absent", () => {
    const cyclic = (a: string) => ({ "a": "b", "b": "a" }[a]);
    expect(matchAction("edit", "a", cyclic)).toBe("unresolvable");
  });

  test("a chain longer than the depth guard is unresolvable, not a silent miss", () => {
    const deep = (a: string) => `n${Number(a.slice(1)) + 1}`;
    expect(matchAction("edit", "n0", deep)).toBe("unresolvable");
    expect(MAX_DERIVATION_DEPTH).toBeGreaterThan(0);
  });

  test("a malformed parent ends the walk without matching", () => {
    expect(matchAction("edit", "x", () => "" as string)).toBe("no-match");
    expect(matchAction("edit", "x", () => undefined)).toBe("no-match");
  });
});

describe("actionAncestry", () => {
  const parentOf = (a: string) => ({ "docs.delete": "docs.update", "docs.update": "edit" }[a]);

  test("lists the action and every ancestor, nearest first", () => {
    expect(actionAncestry("docs.delete", parentOf)).toEqual(["docs.delete", "docs.update", "edit"]);
    expect(actionAncestry("edit", parentOf)).toEqual(["edit"]);
    expect(actionAncestry("edit")).toEqual(["edit"]);
  });

  test("an unresolvable chain is empty, never a truncated one that reads as complete", () => {
    expect(actionAncestry("a", (x) => ({ "a": "b", "b": "a" }[x]))).toEqual([]);
  });
});

describe("indexActionCatalogue", () => {
  test("indexes parents and children for a well-formed catalogue", () => {
    const { parents, children, actions } = indexActionCatalogue(CATALOGUE);
    expect(parents.get("docs.delete")).toBe("docs.update");
    expect(parents.get("edit")).toBeUndefined();
    expect(children.get("edit")).toEqual(["docs.update"]);
    expect(actions.size).toBe(5);
  });

  test("rejects a derivation cycle", () => {
    expect(() =>
      indexActionCatalogue([
        { action: "a", derivesFrom: "b" },
        { action: "b", derivesFrom: "a" },
      ])
    ).toThrow(ActionCatalogueError);
  });

  test("rejects a longer cycle that no single entry reveals", () => {
    expect(() =>
      indexActionCatalogue([
        { action: "a", derivesFrom: "b" },
        { action: "b", derivesFrom: "c" },
        { action: "c", derivesFrom: "a" },
      ])
    ).toThrow(/cycle/);
  });

  test("rejects deriving from an action that is not declared", () => {
    expect(() => indexActionCatalogue([{ action: "a", derivesFrom: "ghost" }]))
      .toThrow(/unknown action "ghost"/);
  });

  test("rejects self-derivation, a duplicate, and a wildcard", () => {
    expect(() => indexActionCatalogue([{ action: "a", derivesFrom: "a" }])).toThrow(/itself/);
    expect(() => indexActionCatalogue([{ action: "a" }, { action: "a" }])).toThrow(/twice/);
    expect(() => indexActionCatalogue([{ action: "a.*" }])).toThrow(/wildcard/);
    expect(() => indexActionCatalogue([{ action: "" }])).toThrow(ActionCatalogueError);
  });
});

describe("actionRegistryFromCatalogue", () => {
  const registry = actionRegistryFromCatalogue(CATALOGUE);

  test("still gates every action through the closed vocabulary", () => {
    expect(registry.isKnownAction("docs.delete")).toBe(true);
    expect(registry.isKnownAction("docs.invented")).toBe(false);
  });

  test("enumerates the closure, which is what distinguishes this from a wildcard", () => {
    expect(registry.descendantsOf!("edit")).toEqual(["docs.delete", "docs.update"]);
    expect(registry.descendantsOf!("read")).toEqual(["docs.read"]);
    expect(registry.descendantsOf!("docs.delete")).toEqual([]);
  });

  test("exposes the parent lookup the evaluator walks", () => {
    expect(registry.parentOf!("docs.update")).toBe("edit");
    expect(registry.parentOf!("edit")).toBeUndefined();
  });

  test("a list-built registry declares no derivation at all", () => {
    const flat = actionRegistryFromList(["edit", "docs.update"]);
    expect(flat.parentOf).toBeUndefined();
    expect(flat.descendantsOf).toBeUndefined();
  });
});
