import { describe, expect, test } from "bun:test";
import { loadDescriptorFixture } from "../src/conformance/index.js";
import { resolveConditionKeys } from "../src/core/conditions.js";
import { describeAuthz } from "../src/core/describe.js";
import { validateStatements } from "../src/core/validate.js";
import { CONDITION_OPERATORS, type ConditionOperator } from "../src/model/condition.js";
import { DESCRIPTOR_VERSION } from "../src/model/descriptor.js";
import { actionRegistryFromCatalogue, actionRegistryFromList } from "../src/ports/index.js";

const fixture = loadDescriptorFixture();

function describeFixture() {
  return describeAuthz({
    actionRegistry: actionRegistryFromCatalogue(fixture.vocabulary.actions),
    conditionKeys: fixture.vocabulary.conditionKeys,
    scopeKinds: fixture.vocabulary.scopeKinds,
  });
}

describe("descriptor golden", () => {
  test("a known vocabulary produces exactly the golden document", () => {
    expect(describeFixture()).toEqual(fixture.expected);
  });

  test("the golden document declares the version the code emits", () => {
    expect(fixture.expected.version).toBe(DESCRIPTOR_VERSION);
  });
});

describe("descriptor degradation", () => {
  test("a registry without derivation yields actions but no closures", () => {
    const d = describeAuthz({ actionRegistry: actionRegistryFromList(["a.read", "a.write"]) });
    expect(d.actions).toEqual([{ action: "a.read" }, { action: "a.write" }]);
    expect(d.actionClosures).toEqual({});
  });

  test("a registry that cannot enumerate degrades to an empty catalogue", () => {
    const d = describeAuthz({ actionRegistry: { isKnownAction: () => true } });
    expect(d.actions).toEqual([]);
    expect(d.actionClosures).toEqual({});
  });

  test("the built-in request:* keys are described even with no host keys", () => {
    const d = describeAuthz();
    expect(d.conditionKeys["request:SourceIp"]).toEqual({
      type: "ip",
      builtIn: true,
      operators: ["IpAddress", "NotIpAddress"],
    });
    expect(d.conditionKeys["app:Region"]).toBeUndefined();
  });

  test("a host key is never marked builtIn, and a built-in always is", () => {
    const d = describeFixture();
    expect(d.conditionKeys["app:Region"]!.builtIn).toBeUndefined();
    expect(d.conditionKeys["request:Time"]!.builtIn).toBe(true);
  });
});

// A value the operator itself accepts, so the ONLY reason validateStatements
// can reject is the key-type rule the descriptor claims to mirror.
function boundFor(operator: ConditionOperator): { value?: string; values?: string[]; } {
  const scalar = operator.startsWith("Numeric")
    ? "1"
    : operator.startsWith("Date")
    ? "2026-01-01T00:00:00Z"
    : operator.endsWith("IpAddress")
    ? "10.0.0.0/8"
    : "eu-west";
  if (operator === "StringIn" || operator === "StringNotIn" || operator === "StringLikeIn") {
    return { values: ["eu-west"] };
  }
  return { value: scalar };
}

describe("descriptor operator round-trip", () => {
  const descriptor = describeFixture();
  const vocabulary = {
    isKnownAction: actionRegistryFromCatalogue(fixture.vocabulary.actions).isKnownAction,
    conditionKeys: resolveConditionKeys(fixture.vocabulary.conditionKeys),
  };

  for (const [key, spec] of Object.entries(descriptor.conditionKeys)) {
    for (const operator of CONDITION_OPERATORS) {
      const advertised = spec.operators.includes(operator);
      test(`${key} ${advertised ? "accepts" : "rejects"} ${operator}`, () => {
        const result = validateStatements([{
          effect: "allow",
          actions: ["widgets.read"],
          resources: ["*"],
          conditions: [{ operator, key, ...boundFor(operator) }],
        }], vocabulary);
        expect(result.ok).toBe(advertised);
      });
    }
  }

  test("every advertised set operator is in setOperators, and no other is", () => {
    for (const [, spec] of Object.entries(descriptor.conditionKeys)) {
      for (const operator of spec.operators) {
        const takesValues = boundFor(operator).values !== undefined;
        expect(descriptor.setOperators.includes(operator)).toBe(takesValues);
      }
    }
  });
});
