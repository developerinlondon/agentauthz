import { describe, expect, test } from "bun:test";
import {
  composedEngineImpl,
  loadConformanceCases,
  pureEvaluatorImpl,
} from "../src/conformance/index.js";

// The golden fixtures are the backend flip contract. Both reference
// implementations — the pure evaluator over the raw grant universe, and the
// composed ports engine over the in-memory store — must decide every case
// identically; a storage backend runs the same cases (tests/pg.test.ts).

const cases = loadConformanceCases();

test("the fixture suite is non-trivial (a broken loader must not pass vacuously)", () => {
  expect(cases.length).toBeGreaterThanOrEqual(80);
  const suites = new Set(cases.map((c) => c.suite));
  for (
    const expected of [
      "resource-matching",
      "deny-wins",
      "scope-chain",
      "conditions",
      "asymmetric-fail-closed",
      "role-synthesis",
    ]
  ) {
    expect(suites.has(expected)).toBe(true);
  }
});

describe("pure evaluator", () => {
  for (const c of cases) {
    test(`${c.suite}: ${c.name}`, async () => {
      expect(await pureEvaluatorImpl(c)).toBe(c.expect);
    });
  }
});

describe("composed engine over the memory store", () => {
  for (const c of cases) {
    test(`${c.suite}: ${c.name}`, async () => {
      expect(await composedEngineImpl(c)).toBe(c.expect);
    });
  }
});
