import { describe, expect, test } from "bun:test";
import {
  BUILTIN_CONDITION_KEYS,
  builtinContextEntries,
  evalConditions,
  makeConditionContext,
  resolveConditionKeys,
  validateConditions,
} from "../src/core/conditions.js";
import type { ConditionContext } from "../src/model/condition.js";

// The pure tri-state ABAC engine: every whitelisted operator's match and
// non-match, and every fail-closed path (unknown operator, unknown key,
// unpopulated key, type mismatch, malformed shape, crafted keys), against a
// host-declared key set merged with the built-in request:* keys.

const KEYS = resolveConditionKeys({
  "app:Email": { type: "string", lowercase: true },
  "app:Kind": { type: "string" },
  "app:Role": { type: "string" },
  "app:Source": { type: "string" },
  "app:ScopeKind": { type: "string" },
  "app:ScopeId": { type: "string" },
});

// A fully-populated context, fabricated so time-dependent operators are
// deterministic.
const CTX: ConditionContext = makeConditionContext({
  "app:Email": "alice@example.com",
  "app:Kind": "user",
  "app:Role": ["ops", "on-call"],
  "app:Source": "admin-api",
  "app:ScopeKind": "space",
  "app:ScopeId": "space-1",
  "request:Time": "2026-07-14T12:30:00.000Z",
  "request:HourUTC": 12,
  "request:SourceIp": "10.1.2.3",
});

const cond = (operator: string, key: string, value: string) => [{ operator, key, value }];
const evalOne = (operator: string, key: string, value: string, ctx: ConditionContext = CTX) =>
  evalConditions(cond(operator, key, value), ctx, KEYS);

describe("evalConditions operators", () => {
  test("StringEquals: match and non-match", () => {
    expect(evalOne("StringEquals", "app:Source", "admin-api")).toBe("match");
    expect(evalOne("StringEquals", "app:Source", "token-gate")).toBe("no-match");
  });

  test("StringNotEquals: match and non-match", () => {
    expect(evalOne("StringNotEquals", "app:Source", "token-gate")).toBe("match");
    expect(evalOne("StringNotEquals", "app:Source", "admin-api")).toBe("no-match");
  });

  test("StringLike: exact, trailing-* prefix, and non-match", () => {
    expect(evalOne("StringLike", "app:Email", "alice@example.com")).toBe("match");
    expect(evalOne("StringLike", "app:Email", "alice@*")).toBe("match");
    expect(evalOne("StringLike", "app:Email", "bob@*")).toBe("no-match");
  });

  test("StringLike: a non-trailing or multiple * is unmatchable, not a wildcard", () => {
    expect(evalOne("StringLike", "app:Email", "*@example.com")).toBe("unmatchable");
    expect(evalOne("StringLike", "app:Email", "a*b*")).toBe("unmatchable");
  });

  test("NumericLessThan / NumericGreaterThan on request:HourUTC", () => {
    expect(evalOne("NumericLessThan", "request:HourUTC", "18")).toBe("match");
    expect(evalOne("NumericLessThan", "request:HourUTC", "12")).toBe("no-match");
    expect(evalOne("NumericGreaterThan", "request:HourUTC", "8")).toBe("match");
    expect(evalOne("NumericGreaterThan", "request:HourUTC", "12")).toBe("no-match");
  });

  test("DateLessThan / DateGreaterThan on request:Time", () => {
    expect(evalOne("DateLessThan", "request:Time", "2026-08-01T00:00:00Z")).toBe("match");
    expect(evalOne("DateLessThan", "request:Time", "2026-07-01T00:00:00Z")).toBe("no-match");
    expect(evalOne("DateGreaterThan", "request:Time", "2026-07-01T00:00:00Z")).toBe("match");
    expect(evalOne("DateGreaterThan", "request:Time", "2026-08-01T00:00:00Z")).toBe("no-match");
  });

  test("StringEquals/StringLike on an array-valued key are existential (ANY element matches)", () => {
    expect(evalOne("StringEquals", "app:Role", "ops")).toBe("match");
    expect(evalOne("StringEquals", "app:Role", "billing")).toBe("no-match");
    expect(evalOne("StringLike", "app:Role", "on-*")).toBe("match");
    expect(evalOne("StringLike", "app:Role", "off-*")).toBe("no-match");
  });

  test("StringNotEquals on an array-valued key is universal (NONE match — the exact complement)", () => {
    expect(evalOne("StringNotEquals", "app:Role", "ops")).toBe("no-match"); // "ops" IS held
    expect(evalOne("StringNotEquals", "app:Role", "billing")).toBe("match"); // "billing" is NOT
  });

  test("IpAddress/NotIpAddress: IPv4 CIDR membership", () => {
    expect(evalOne("IpAddress", "request:SourceIp", "10.0.0.0/8")).toBe("match");
    expect(evalOne("IpAddress", "request:SourceIp", "192.168.0.0/16")).toBe("no-match");
    expect(evalOne("NotIpAddress", "request:SourceIp", "10.0.0.0/8")).toBe("no-match");
    expect(evalOne("NotIpAddress", "request:SourceIp", "192.168.0.0/16")).toBe("match");
  });

  test("IpAddress CIDR edge cases: /32 exact host and /0 match-everything", () => {
    expect(evalOne("IpAddress", "request:SourceIp", "10.1.2.3/32")).toBe("match");
    expect(evalOne("IpAddress", "request:SourceIp", "10.1.2.4/32")).toBe("no-match");
    expect(evalOne("IpAddress", "request:SourceIp", "0.0.0.0/0")).toBe("match");
  });

  test("IpAddress: IPv6 CIDR membership, including ::/0", () => {
    const v6 = makeConditionContext({ ...CTX, "request:SourceIp": "2001:db8::1" });
    expect(evalOne("IpAddress", "request:SourceIp", "2001:db8::/32", v6)).toBe("match");
    expect(evalOne("IpAddress", "request:SourceIp", "2001:db9::/32", v6)).toBe("no-match");
    expect(evalOne("IpAddress", "request:SourceIp", "::/0", v6)).toBe("match");
    expect(evalOne("IpAddress", "request:SourceIp", "::1/128", v6)).toBe("no-match");
  });

  test("IpAddress: a malformed CIDR, an out-of-range prefix, or a family mismatch is unmatchable", () => {
    for (
      const cidr of [
        "not-a-cidr",
        "10.0.0.0",
        "10.0.0.0/33",
        "2001:db8::/129",
        "10.0.0.0/-1",
        "2001:db8::/32", // family mismatch against the IPv4 CTX value
      ]
    ) {
      expect(evalOne("IpAddress", "request:SourceIp", cidr)).toBe("unmatchable");
    }
  });

  test("IpAddress: rejects a leading-zero octet, an out-of-range octet, and a 5-octet address", () => {
    for (
      const cidr of [
        "010.0.0.0/8", // leading zero — some parsers read this as octal
        "10.0.0.1/8", // canonical octets, sanity control — accepted, not a rejection case
        "256.0.0.0/8", // out of range
        "10.0.0.0.0/8", // 5 octets
      ]
    ) {
      const expected = cidr === "10.0.0.1/8" ? "match" : "unmatchable";
      expect(evalOne("IpAddress", "request:SourceIp", cidr)).toBe(expected);
    }
  });

  test("multiple conditions AND together", () => {
    const both = [
      { operator: "StringEquals", key: "app:Source", value: "admin-api" },
      { operator: "NumericLessThan", key: "request:HourUTC", value: "18" },
    ];
    expect(evalConditions(both, CTX, KEYS)).toBe("match");
    expect(
      evalConditions(
        [...both, { operator: "StringEquals", key: "app:ScopeKind", value: "root" }],
        CTX,
        KEYS,
      ),
    ).toBe("no-match");
  });

  test("absent conditions and an empty array both mean match (conditionless behavior)", () => {
    expect(evalConditions(undefined, CTX, KEYS)).toBe("match");
    expect(evalConditions(null, CTX, KEYS)).toBe("match");
    expect(evalConditions([], CTX, KEYS)).toBe("match");
  });
});

describe("evalConditions fail-closed paths", () => {
  test("unknown operator is unmatchable", () => {
    expect(evalOne("StringWhatever", "app:Source", "x")).toBe("unmatchable");
    expect(evalOne("Bogus", "app:Source", "10.0.0.0/8")).toBe("unmatchable");
  });

  test("unknown key is unmatchable — including crafted prototype-chain keys", () => {
    for (const key of ["app:Moon", "request:Ip", "__proto__", "constructor", "toString"]) {
      expect(evalOne("StringEquals", key, "x")).toBe("unmatchable");
    }
  });

  test("a declared key the context does not populate is unmatchable", () => {
    const noEmail = makeConditionContext({ ...CTX });
    delete noEmail["app:Email"];
    expect(evalOne("StringEquals", "app:Email", "alice@example.com", noEmail))
      .toBe("unmatchable");
  });

  // CRITICAL: this is the mechanism that makes an allow with a SourceIp/role
  // condition never match a check whose context lacks the value, and a deny
  // with either condition fire instead — asymmetric fail-closed.
  test("SourceIp/role keys are unmatchable when the context doesn't populate them", () => {
    const bare = makeConditionContext({ ...CTX });
    delete bare["request:SourceIp"];
    delete bare["app:Role"];
    expect(evalOne("IpAddress", "request:SourceIp", "10.0.0.0/8", bare)).toBe("unmatchable");
    expect(evalOne("StringEquals", "app:Role", "ops", bare)).toBe("unmatchable");
    expect(evalOne("StringNotEquals", "app:Role", "contractor", bare)).toBe("unmatchable");
  });

  test("operator/key type mismatch is unmatchable", () => {
    expect(evalOne("NumericLessThan", "app:Source", "5")).toBe("unmatchable");
    expect(evalOne("StringEquals", "request:HourUTC", "12")).toBe("unmatchable");
    expect(evalOne("DateLessThan", "request:HourUTC", "2026-01-01")).toBe("unmatchable");
  });

  test("malformed shapes are unmatchable", () => {
    for (
      const bad of [
        "yes",
        42,
        {},
        { operator: "StringEquals" },
        [null],
        ["x"],
        [[]],
        [{ operator: "StringEquals", key: "app:Source" }], // missing value
        [{ operator: "StringEquals", key: "app:Source", value: 5 }], // non-string value
        [{ operator: 5, key: "app:Source", value: "x" }],
      ]
    ) {
      expect(evalConditions(bad, CTX, KEYS)).toBe("unmatchable");
    }
  });

  test("unparseable numeric/date values are unmatchable", () => {
    expect(evalOne("NumericLessThan", "request:HourUTC", "lots")).toBe("unmatchable");
    expect(evalOne("NumericLessThan", "request:HourUTC", " ")).toBe("unmatchable");
    expect(evalOne("DateLessThan", "request:Time", "next tuesday")).toBe("unmatchable");
  });

  test("unmatchable outranks no-match regardless of order", () => {
    const falseCond = { operator: "StringEquals", key: "app:Source", value: "nope" };
    const badCond = { operator: "Bogus", key: "app:Source", value: "x" };
    expect(evalConditions([falseCond, badCond], CTX, KEYS)).toBe("unmatchable");
    expect(evalConditions([badCond, falseCond], CTX, KEYS)).toBe("unmatchable");
  });

  test("a lowercase key compares case-insensitively in BOTH directions (no widening)", () => {
    // A mixed-case authored value against the lowercased context value: a
    // case-sensitive compare would let StringNotEquals fail OPEN (excluding
    // no one) and a StringEquals deny fail to fire.
    expect(evalOne("StringEquals", "app:Email", "Alice@Example.COM")).toBe("match");
    expect(evalOne("StringNotEquals", "app:Email", "Alice@Example.COM")).toBe("no-match");
  });

  test("a lowercase key also normalizes the CONTEXT value — scalar and array elements", () => {
    // The host builds the context, so a host that forgets to lowercase must
    // not reopen the widening from the other side: a mixed-case ctx value
    // would let StringNotEquals fail OPEN and a StringEquals deny miss.
    const mixed = makeConditionContext({ ...CTX, "app:Email": "Alice@Example.COM" });
    expect(evalOne("StringEquals", "app:Email", "alice@example.com", mixed)).toBe("match");
    expect(evalOne("StringNotEquals", "app:Email", "alice@example.com", mixed)).toBe("no-match");
    expect(evalOne("StringLike", "app:Email", "alice@*", mixed)).toBe("match");

    const lcKeys = resolveConditionKeys({ "app:Aliases": { type: "string", lowercase: true } });
    const arr = makeConditionContext({ "app:Aliases": ["Ops-Lead", "On-Call"] });
    expect(evalConditions(
      [{ operator: "StringEquals", key: "app:Aliases", value: "ops-lead" }],
      arr,
      lcKeys,
    )).toBe("match");
    expect(evalConditions(
      [{ operator: "StringNotEquals", key: "app:Aliases", value: "Ops-Lead" }],
      arr,
      lcKeys,
    )).toBe("no-match");
  });
});

describe("condition key declarations and context helpers", () => {
  test("built-in request:* keys always win over a host redeclaration", () => {
    const keys = resolveConditionKeys({
      "request:Time": { type: "string" }, // host tries to redefine — ignored
    });
    expect(keys["request:Time"]).toEqual(BUILTIN_CONDITION_KEYS["request:Time"]!);
  });

  test("the context has no prototype for crafted keys to reach", () => {
    expect(Object.getPrototypeOf(makeConditionContext({}))).toBe(null);
    expect(Object.getPrototypeOf(makeConditionContext({ a: "b" }))).toBe(null);
  });

  test("builtinContextEntries populates Time/HourUTC and SourceIp only when given", () => {
    const now = new Date("2026-07-14T09:15:00Z");
    const withIp = builtinContextEntries({ now, sourceIp: "10.1.2.3" });
    expect(withIp["request:Time"]).toBe("2026-07-14T09:15:00.000Z");
    expect(withIp["request:HourUTC"]).toBe(9);
    expect(withIp["request:SourceIp"]).toBe("10.1.2.3");
  });

  test("an empty-string or null sourceIp leaves request:SourceIp unpopulated (never fabricated)", () => {
    for (const sourceIp of ["", null, undefined]) {
      const entries = builtinContextEntries({ sourceIp });
      expect(Object.hasOwn(entries, "request:SourceIp")).toBe(false);
    }
  });
});

describe("write-time validation (validateConditions)", () => {
  test("accepts one condition of each operator family", () => {
    const v = validateConditions([
      { operator: "StringEquals", key: "app:Email", value: "a@example.com" },
      { operator: "StringLike", key: "app:Source", value: "admin-*" },
      { operator: "NumericGreaterThan", key: "request:HourUTC", value: "8" },
      { operator: "DateLessThan", key: "request:Time", value: "2026-08-01T00:00:00Z" },
      { operator: "IpAddress", key: "request:SourceIp", value: "10.0.0.0/8" },
    ], KEYS);
    expect(v.ok).toBe(true);
  });

  test("accepts an empty array (vacuously true, like AWS)", () => {
    expect(validateConditions([], KEYS).ok).toBe(true);
  });

  test("rejects unknown operators, unknown keys, and type mismatches by name", () => {
    for (
      const [input, needle] of [
        [[{ operator: "Bogus", key: "app:Source", value: "x" }], "unknown operator"],
        [[{ operator: "StringEquals", key: "request:Ip", value: "x" }], "unknown key"],
        [[{ operator: "NumericLessThan", key: "app:Source", value: "5" }], "cannot test"],
        [[{ operator: "IpAddress", key: "app:Source", value: "10.0.0.0/8" }], "cannot test"],
        [[{ operator: "IpAddress", key: "request:SourceIp", value: "not-a-cidr" }], "not a valid"],
        [[{ operator: "StringEquals", key: "app:Source", value: "" }], "non-empty string"],
        [[{ operator: "NumericLessThan", key: "request:HourUTC", value: "lots" }], "not a number"],
        [[{ operator: "DateLessThan", key: "request:Time", value: "someday" }], "not a parseable"],
        [[{ operator: "StringLike", key: "app:Source", value: "a*b" }], "trailing *"],
        ["nope", "must be an array"],
        [[null], "not an object"],
      ] as Array<[unknown, string]>
    ) {
      const v = validateConditions(input, KEYS);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toContain(needle);
    }
  });

  test("rejects a malformed CIDR value for IpAddress/NotIpAddress by name", () => {
    for (const value of ["not-a-cidr", "10.0.0.0", "10.0.0.0/33", "2001:db8::/129"]) {
      const v = validateConditions([
        { operator: "IpAddress", key: "request:SourceIp", value },
      ], KEYS);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toContain("not a valid");
    }
    const ok = validateConditions([
      { operator: "NotIpAddress", key: "request:SourceIp", value: "2001:db8::/32" },
    ], KEYS);
    expect(ok.ok).toBe(true);
  });

  test("a TZ-less date value is rejected; an explicit Z or numeric offset is accepted", () => {
    const rejected = validateConditions([
      { operator: "DateLessThan", key: "request:Time", value: "2026-08-01T00:00:00" },
    ], KEYS);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toContain("timezone");

    const accepted = validateConditions([
      { operator: "DateLessThan", key: "request:Time", value: "2026-08-01T00:00:00Z" },
    ], KEYS);
    expect(accepted.ok).toBe(true);

    const offset = validateConditions([
      { operator: "DateGreaterThan", key: "request:Time", value: "2026-08-01T00:00:00+05:30" },
    ], KEYS);
    expect(offset.ok).toBe(true);
  });

  test("a lowercase key's value is lowercased on write, independent of eval-time normalization", () => {
    const v = validateConditions([
      { operator: "StringEquals", key: "app:Email", value: "Mixed@Example.COM" },
    ], KEYS);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.conditions[0]!.value).toBe("mixed@example.com");
  });
});


describe("validateConditions — authoring forgiveness and dialect mistakes", () => {
  const NUM_KEYS = resolveConditionKeys({ "app:MaxCpu": { type: "number" } });

  test("a numeric bound authored as a JSON number is normalized, not bounced", () => {
    const v = validateConditions(
      [{ operator: "NumericLessThan", key: "app:MaxCpu", value: 5 }],
      NUM_KEYS,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.conditions[0]!.value).toBe("5");
  });

  test("a non-finite numeric bound is still refused", () => {
    for (const value of [Infinity, NaN]) {
      const v = validateConditions(
        [{ operator: "NumericLessThan", key: "app:MaxCpu", value }],
        NUM_KEYS,
      );
      expect(v.ok).toBe(false);
    }
  });

  test("a number on a STRING operator is not coerced — the type rule stands", () => {
    const v = validateConditions([{ operator: "StringEquals", key: "app:Kind", value: 5 }], KEYS);
    expect(v.ok).toBe(false);
  });

  test("regex alternation in StringLike is refused, naming the fix", () => {
    const v = validateConditions(
      [{ operator: "StringLike", key: "app:Kind", value: "infra|lite" }],
      KEYS,
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("StringIn");
  });

  test("SQL-LIKE % in StringLike is refused, naming the real wildcard", () => {
    const v = validateConditions(
      [{ operator: "StringLike", key: "app:Kind", value: "infra%" }],
      KEYS,
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toContain("trailing *");
  });

  test("the same dialect check covers every StringLikeIn pattern", () => {
    const v = validateConditions(
      [{ operator: "StringLikeIn", key: "app:Kind", values: ["ok*", "a|b"] }],
      KEYS,
    );
    expect(v.ok).toBe(false);
  });

  test("a literal pipe stored in a raw row still evaluates literally (fail closed, unchanged)", () => {
    const verdict = evalConditions(
      [{ operator: "StringLike", key: "app:Kind", value: "infra|lite" }],
      makeConditionContext({ "app:Kind": "infra|lite" }),
      KEYS,
    );
    expect(verdict).toBe("match");
    const miss = evalConditions(
      [{ operator: "StringLike", key: "app:Kind", value: "infra|lite" }],
      makeConditionContext({ "app:Kind": "infra" }),
      KEYS,
    );
    expect(miss).toBe("no-match");
  });
});
