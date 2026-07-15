import { describe, expect, test } from "bun:test";
import { resolveConditionKeys } from "../src/core/conditions.js";
import { validateStatements } from "../src/core/validate.js";
import { isValidAction, isValidResource } from "../src/model/statement.js";
import { actionRegistryFromList } from "../src/ports/index.js";

// Statement validation fails closed against a host-declared action registry:
// no action wildcards ever, resources exact or single-trailing-*.

const REGISTRY = actionRegistryFromList([
  "docs.read",
  "docs.write",
  "docs.manage",
  "tool.invoke",
  "usage.read",
]);
const VOCAB = {
  isKnownAction: (a: string) => REGISTRY.isKnownAction(a),
  conditionKeys: resolveConditionKeys({
    "app:Email": { type: "string", lowercase: true },
    "app:Source": { type: "string" },
  }),
};
const isAction = (a: string) => isValidAction(a, VOCAB.isKnownAction);

describe("statement validation", () => {
  test("accepts registered actions and exact / trailing-* resources", () => {
    expect(isAction("docs.manage")).toBe(true);
    expect(isAction("tool.invoke")).toBe(true);
    expect(isValidResource("doc:support")).toBe(true);
    expect(isValidResource("doc:sales-*")).toBe(true);
    expect(isValidResource("tool:some__tool")).toBe(true);
    expect(isValidResource("tool:*")).toBe(true);
    expect(isValidResource("*")).toBe(true);
    const v = validateStatements([
      { effect: "allow", actions: ["docs.manage", "tool.invoke"], resources: ["doc:*"] },
    ], VOCAB);
    expect(v.ok).toBe(true);
  });

  test("rejects an unknown action", () => {
    expect(isAction("docs.explode")).toBe(false);
    // A per-name suffix on a registered action is also unknown — the target
    // identity lives on the resource side instead.
    expect(isAction("tool.invoke:send_email")).toBe(false);
    const v = validateStatements(
      [{ effect: "allow", actions: ["docs.explode"], resources: ["*"] }],
      VOCAB,
    );
    expect(v.ok).toBe(false);
    expect((v as { ok: false; error: string; }).error).toContain("docs.explode");
  });

  test("rejects an action wildcard, even for a registered prefix", () => {
    expect(isAction("docs.*")).toBe(false);
    expect(isAction("*")).toBe(false);
    expect(isAction("tool.invoke:*")).toBe(false);
    const v = validateStatements(
      [{ effect: "allow", actions: ["docs.*"], resources: ["*"] }],
      VOCAB,
    );
    expect(v.ok).toBe(false);
  });

  test("rejects a non-trailing resource wildcard", () => {
    expect(isValidResource("doc:*-support")).toBe(false);
    expect(isValidResource("a*b*")).toBe(false);
    expect(isValidResource("")).toBe(false);
    const v = validateStatements([
      { effect: "allow", actions: ["docs.read"], resources: ["doc:*-support"] },
    ], VOCAB);
    expect(v.ok).toBe(false);
    expect((v as { ok: false; error: string; }).error).toContain("trailing");
  });

  test("rejects empty / malformed shapes", () => {
    expect(validateStatements([], VOCAB).ok).toBe(false);
    expect(validateStatements("nope", VOCAB).ok).toBe(false);
    expect(
      validateStatements([{ effect: "maybe", actions: ["docs.read"], resources: ["*"] }], VOCAB).ok,
    ).toBe(false);
    expect(validateStatements([{ effect: "allow", actions: [], resources: ["*"] }], VOCAB).ok)
      .toBe(false);
    expect(
      validateStatements([{ effect: "allow", actions: ["docs.read"], resources: [] }], VOCAB).ok,
    )
      .toBe(false);
  });

  test("accepts valid conditions and surfaces condition errors with the statement index", () => {
    const good = validateStatements([{
      effect: "allow",
      actions: ["docs.read"],
      resources: ["*"],
      conditions: [{ operator: "StringEquals", key: "app:Source", value: "api" }],
    }], VOCAB);
    expect(good.ok).toBe(true);

    const bad = validateStatements([{
      effect: "allow",
      actions: ["docs.read"],
      resources: ["*"],
      conditions: [{ operator: "Bogus", key: "app:Source", value: "x" }],
    }], VOCAB);
    expect(bad.ok).toBe(false);
    expect((bad as { ok: false; error: string; }).error).toContain("statement 0");
    expect((bad as { ok: false; error: string; }).error).toContain("unknown operator");
  });

  test("round-trips a conditionless statement without adding a conditions key", () => {
    const v = validateStatements([
      { effect: "allow", actions: ["docs.read"], resources: ["*"] },
    ], VOCAB);
    expect(v.ok).toBe(true);
    if (v.ok) expect(Object.hasOwn(v.statements[0]!, "conditions")).toBe(false);
  });
});
