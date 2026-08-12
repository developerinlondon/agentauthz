import { describe, expect, test } from "bun:test";
import {
  evalConditions,
  makeConditionContext,
  resolveConditionKeys,
  validateConditions,
} from "../src/core/conditions.js";
import { isSetOperator, SET_OPERATORS } from "../src/model/condition.js";

const KEYS = resolveConditionKeys({
  "app:Pool": { type: "string" },
  "app:Cpu": { type: "number" },
  "app:Email": { type: "string", lowercase: true },
});

const ctx = (entries: Record<string, string | number | string[]>) => makeConditionContext(entries);

describe("validateConditions — set operators", () => {
  test("accepts a non-empty values list and stores it", () => {
    const v = validateConditions(
      [{ operator: "StringIn", key: "app:Pool", values: ["infra", "lite"] }],
      KEYS,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.conditions[0]!.values).toEqual(["infra", "lite"]);
    expect(v.conditions[0]!.value).toBeUndefined();
  });

  test("rejects an empty list at write time rather than deferring to a runtime deny", () => {
    const v = validateConditions([{ operator: "StringIn", key: "app:Pool", values: [] }], KEYS);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toContain("non-empty values array");
  });

  test("rejects a missing list, a non-array, and a non-string member", () => {
    for (const values of [undefined, "lite", [""], [1], [null]]) {
      const v = validateConditions([{ operator: "StringIn", key: "app:Pool", values }], KEYS);
      expect(v.ok).toBe(false);
    }
  });

  test("refuses a set operator carrying value, and a scalar operator carrying values", () => {
    const a = validateConditions([{ operator: "StringIn", key: "app:Pool", value: "lite" }], KEYS);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toContain("takes values, not value");

    const b = validateConditions(
      [{ operator: "StringEquals", key: "app:Pool", values: ["lite"] }],
      KEYS,
    );
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toContain("takes value, not values");
  });

  test("rejects a set operator against a key of the wrong type", () => {
    const v = validateConditions([{ operator: "StringIn", key: "app:Cpu", values: ["4"] }], KEYS);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("a number key");
  });

  test("rejects a StringLikeIn pattern with an interior wildcard", () => {
    const v = validateConditions(
      [{ operator: "StringLikeIn", key: "app:Pool", values: ["ok-*", "b*d"] }],
      KEYS,
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("single trailing *");
  });

  test("normalizes stored values for a lowercase-declared key", () => {
    const v = validateConditions(
      [{ operator: "StringIn", key: "app:Email", values: ["Alice@Example.COM"] }],
      KEYS,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.conditions[0]!.values).toEqual(["alice@example.com"]);
  });
});

describe("evalConditions — set membership", () => {
  const cond = (values: unknown, operator = "StringIn") => [{
    operator,
    key: "app:Pool",
    values,
  }];

  test("a member matches and a non-member does not", () => {
    expect(evalConditions(cond(["infra", "lite"]), ctx({ "app:Pool": "lite" }), KEYS))
      .toBe("match");
    expect(evalConditions(cond(["infra", "lite"]), ctx({ "app:Pool": "kata" }), KEYS))
      .toBe("no-match");
  });

  test("an empty list is unmatchable, never a vacuous match", () => {
    expect(evalConditions(cond([]), ctx({ "app:Pool": "lite" }), KEYS)).toBe("unmatchable");
  });

  test("a raw row mixing value and values is unmatchable rather than guessed", () => {
    const mixed = [{ operator: "StringIn", key: "app:Pool", value: "lite", values: ["lite"] }];
    expect(evalConditions(mixed, ctx({ "app:Pool": "lite" }), KEYS)).toBe("unmatchable");
  });

  test("a non-string member in a stored row is unmatchable", () => {
    expect(evalConditions(cond([1]), ctx({ "app:Pool": "lite" }), KEYS)).toBe("unmatchable");
    expect(evalConditions(cond("lite"), ctx({ "app:Pool": "lite" }), KEYS)).toBe("unmatchable");
  });

  test("list context intersects the list value; StringNotIn is its exact negation", () => {
    const roles = resolveConditionKeys({ "app:Roles": { type: "string" } });
    const c = (op: string) => [{ operator: op, key: "app:Roles", values: ["ops", "sre"] }];
    const held = makeConditionContext({ "app:Roles": ["dev", "sre"] });
    expect(evalConditions(c("StringIn"), held, roles)).toBe("match");
    expect(evalConditions(c("StringNotIn"), held, roles)).toBe("no-match");

    const none = makeConditionContext({ "app:Roles": ["dev"] });
    expect(evalConditions(c("StringIn"), none, roles)).toBe("no-match");
    expect(evalConditions(c("StringNotIn"), none, roles)).toBe("match");
  });

  test("StringLikeIn honours prefix patterns and rejects an interior wildcard at eval time", () => {
    expect(evalConditions(cond(["infra-*"], "StringLikeIn"), ctx({ "app:Pool": "infra-eu" }), KEYS))
      .toBe("match");
    expect(evalConditions(cond(["infra-*"], "StringLikeIn"), ctx({ "app:Pool": "lite-eu" }), KEYS))
      .toBe("no-match");
    expect(evalConditions(cond(["b*d"], "StringLikeIn"), ctx({ "app:Pool": "bad" }), KEYS))
      .toBe("unmatchable");
  });

  test("an unpopulated key stays unmatchable for a set operator too", () => {
    expect(evalConditions(cond(["lite"]), ctx({}), KEYS)).toBe("unmatchable");
  });

  test("one condition replaces the statement-per-value product", () => {
    const pools = ["infra", "lite", "kata"];
    const single = [{ operator: "StringIn", key: "app:Pool", values: pools }];
    for (const pool of pools) {
      expect(evalConditions(single, ctx({ "app:Pool": pool }), KEYS)).toBe("match");
    }
    expect(evalConditions(single, ctx({ "app:Pool": "other" }), KEYS)).toBe("no-match");
  });
});

describe("SET_OPERATORS", () => {
  test("names exactly the list-valued operators", () => {
    expect([...SET_OPERATORS]).toEqual(["StringIn", "StringNotIn", "StringLikeIn"]);
    for (const op of SET_OPERATORS) expect(isSetOperator(op)).toBe(true);
    for (const op of ["StringEquals", "StringLike", "IpAddress"]) {
      expect(isSetOperator(op)).toBe(false);
    }
  });
});
