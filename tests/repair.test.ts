import { describe, expect, test } from "bun:test";
import { resolveConditionKeys } from "../src/core/conditions.js";
import { repairDraft } from "../src/core/repair.js";

// Draft repair: an AI-drafted policy's raw JSON is never trusted — unknown
// actions/resources are dropped statement-by-statement, a statement with any
// invalid condition is dropped whole (deleting a condition would WIDEN it),
// and a draft left with nothing is rejected.

const KNOWN_TOOLS = new Set(["tool:Bash", "tool:Write"]);
const VOCAB = {
  isKnownAction: (a: string) => ["docs.read", "docs.write", "tool.invoke"].includes(a),
  // A tool: resource must name a real tool; the trailing-* wildcard and
  // non-tool resources pass on shape alone — mirroring a host that validates
  // only the vocabularies it owns.
  isKnownResource: (r: string) => !r.startsWith("tool:") || r === "tool:*" || KNOWN_TOOLS.has(r),
  conditionKeys: resolveConditionKeys({ "app:Source": { type: "string" } }),
};

const base = { effect: "allow", actions: ["docs.read"], resources: ["*"] };

describe("repairDraft", () => {
  test("keeps a fully valid draft, trimming name/description", () => {
    const r = repairDraft({
      name: "  my draft  ",
      description: "  does things  ",
      statements: [base],
    }, VOCAB);
    expect(r.ok).toBe(true);
    expect(r.name).toBe("my draft");
    expect(r.description).toBe("does things");
    expect(r.statements).toEqual([base] as never);
    expect(r.warnings).toEqual([]);
  });

  test("drops an unknown or wildcard action with a warning, keeping the rest", () => {
    const r = repairDraft({
      name: "d",
      statements: [{
        effect: "allow",
        actions: ["docs.read", "docs.explode", "docs.*"],
        resources: ["*"],
      }],
    }, VOCAB);
    expect(r.ok).toBe(true);
    expect(r.statements[0]!.actions).toEqual(["docs.read"]);
    expect(r.warnings.join(" ")).toContain("docs.explode");
    expect(r.warnings.join(" ")).toContain("docs.*");
  });

  test("drops an invalid or hallucinated resource with a warning", () => {
    const r = repairDraft({
      name: "d",
      statements: [{
        effect: "allow",
        actions: ["tool.invoke"],
        resources: ["tool:Bash", "tool:MadeUpTool", "a*b*", "tool:*"],
      }],
    }, VOCAB);
    expect(r.ok).toBe(true);
    expect(r.statements[0]!.resources).toEqual(["tool:Bash", "tool:*"]);
    expect(r.warnings.join(" ")).toContain("tool:MadeUpTool");
    expect(r.warnings.join(" ")).toContain("a*b*");
  });

  test("drops a statement left with no valid actions or resources", () => {
    const r = repairDraft({
      name: "d",
      statements: [
        { effect: "allow", actions: ["nope"], resources: ["*"] },
        base,
      ],
    }, VOCAB);
    expect(r.ok).toBe(true);
    expect(r.statements.length).toBe(1);
    expect(r.warnings.join(" ")).toContain("no valid actions or resources");
  });

  test("drops a statement with an invalid or missing effect", () => {
    const r = repairDraft({
      name: "d",
      statements: [{ effect: "maybe", actions: ["docs.read"], resources: ["*"] }, base],
    }, VOCAB);
    expect(r.ok).toBe(true);
    expect(r.statements.length).toBe(1);
    expect(r.warnings.join(" ")).toContain("invalid or missing effect");
  });

  test("keeps valid conditions verbatim", () => {
    const r = repairDraft({
      name: "d",
      statements: [{
        ...base,
        conditions: [{ operator: "StringEquals", key: "app:Source", value: "api" }],
      }],
    }, VOCAB);
    expect(r.ok).toBe(true);
    expect(r.statements[0]!.conditions).toEqual([
      { operator: "StringEquals", key: "app:Source", value: "api" },
    ]);
  });

  test("drops a statement WHOLE on any invalid condition — never repaired by deletion", () => {
    const r = repairDraft({
      name: "d",
      statements: [{
        ...base,
        conditions: [{ operator: "IpAddress", key: "aws:SourceIp", value: "10.0.0.0/8" }],
      }],
    }, VOCAB);
    expect(r.ok).toBe(false);
    expect(r.warnings.join(" ")).toContain("invalid conditions");
    expect(r.warnings.join(" ")).toContain("never");
  });

  test("a draft with no usable statements is rejected with a name-safe fallback", () => {
    const empty = repairDraft({ name: "d", statements: [] }, VOCAB);
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain("no usable statements");

    const junk = repairDraft("not even an object", VOCAB);
    expect(junk.ok).toBe(false);

    // A usable draft with no name gets the fallback.
    const unnamed = repairDraft({ statements: [base] }, VOCAB);
    expect(unnamed.ok).toBe(true);
    expect(unnamed.name).toBe("ai-draft");
  });

  test("clamps an over-long name and description", () => {
    const r = repairDraft({
      name: "x".repeat(100),
      description: "y".repeat(400),
      statements: [base],
    }, VOCAB);
    expect(r.ok).toBe(true);
    expect(r.name.length).toBe(60);
    expect(r.description!.length).toBe(300);
  });
});
