import { describe, expect, test } from "bun:test";
import { canApprove, inboxVisible, resolveApprover } from "../src/core/approvals.js";

// Pure separation-of-duties rule. No I/O — the host wraps this after
// resolving the decider's roles. Signature:
// canApprove(requiredRole, requiredUsers, decider, requester, deciderRoles).
describe("canApprove", () => {
  test("no role and no users defers to the caller (owner/admin rule)", () => {
    // The decider/roles are irrelevant when no gate applies.
    expect(canApprove(null, null, "dev@x", "dev@x", [])).toBe(true);
    expect(canApprove(null, [], "dev@x", "dev@x", [])).toBe(true);
    expect(canApprove(null, null, null, null, [])).toBe(true);
  });

  test("a role holder who is not the requester may decide", () => {
    expect(canApprove("security", null, "sec@x", "dev@x", ["security"])).toBe(true);
    expect(canApprove("security", null, "sec@x", "dev@x", ["admin", "security"])).toBe(true);
  });

  test("a named user who is not the requester may decide", () => {
    expect(canApprove(null, ["boss@x"], "boss@x", "dev@x", [])).toBe(true);
    // one of several listed users
    expect(canApprove(null, ["a@x", "boss@x"], "boss@x", "dev@x", [])).toBe(true);
  });

  test("role OR user satisfies the gate (either alone is enough)", () => {
    // holds the role but is not a listed user
    expect(canApprove("security", ["boss@x"], "sec@x", "dev@x", ["security"])).toBe(true);
    // is a listed user but lacks the role
    expect(canApprove("security", ["boss@x"], "boss@x", "dev@x", ["reviewer"])).toBe(true);
  });

  test("the requester cannot self-approve even when listed as a user", () => {
    expect(canApprove(null, ["dev@x"], "dev@x", "dev@x", [])).toBe(false);
    // requester holding the role is also blocked
    expect(canApprove("security", ["dev@x"], "dev@x", "dev@x", ["security"])).toBe(false);
  });

  test("the special value 'self' lets the requester approve their own", () => {
    expect(canApprove(null, ["self"], "dev@x", "dev@x", [])).toBe(true);
    // self composes with a role: the requester OR a role holder may decide
    expect(canApprove("security", ["self"], "dev@x", "dev@x", [])).toBe(true);
    expect(canApprove("security", ["self"], "sec@x", "dev@x", ["security"])).toBe(true);
  });

  test("'self' does not admit anyone other than the requester", () => {
    // a non-requester isn't "self" and holds no role / isn't a named email
    expect(canApprove(null, ["self"], "other@x", "dev@x", [])).toBe(false);
    // an anonymous decider is still denied
    expect(canApprove(null, ["self"], null, "dev@x", [])).toBe(false);
  });

  test("neither role nor user matches ⇒ denied when gated", () => {
    expect(canApprove("security", ["boss@x"], "dev@x", "req@x", ["reviewer"])).toBe(false);
    expect(canApprove("security", null, "dev@x", "req@x", [])).toBe(false);
    expect(canApprove(null, ["boss@x"], "dev@x", "req@x", [])).toBe(false);
  });

  test("a null decider (anonymous) is denied when a gate applies", () => {
    expect(canApprove("security", null, null, "dev@x", [])).toBe(false);
    expect(canApprove(null, ["boss@x"], null, "dev@x", [])).toBe(false);
  });
});

// Three-tier approver resolution: a tool's own approver → the "*" default →
// the built-in "self" fallback.
describe("resolveApprover", () => {
  test("a tool's own approver wins whole", () => {
    expect(resolveApprover({ Bash: "security" }, {}, "Bash")).toEqual({
      role: "security",
      users: null,
    });
    expect(resolveApprover({}, { Bash: ["self"] }, "Bash")).toEqual({
      role: null,
      users: ["self"],
    });
  });

  test("falls back to the '*' default when the tool has none", () => {
    expect(resolveApprover({ "*": "security" }, {}, "Bash")).toEqual({
      role: "security",
      users: null,
    });
    expect(resolveApprover({}, { "*": ["self"] }, "Write")).toEqual({
      role: null,
      users: ["self"],
    });
  });

  test("the tool overrides the '*' default", () => {
    expect(resolveApprover({ "*": "security", Bash: "ops" }, {}, "Bash"))
      .toEqual({ role: "ops", users: null });
  });

  test("with neither, 'self' is the fallback (requester confirms their own)", () => {
    expect(resolveApprover({}, {}, "Bash")).toEqual({ role: null, users: ["self"] });
    expect(resolveApprover(undefined, undefined, "Bash")).toEqual({ role: null, users: ["self"] });
    // an empty user list doesn't count as set
    expect(resolveApprover({}, { Bash: [] }, "Bash")).toEqual({ role: null, users: ["self"] });
  });
});

// Pure inbox-routing rule: which gated requests show up in a given approver's
// cross-thread inbox.
describe("inboxVisible", () => {
  const row = (
    required_role: string | null,
    required_users: string[] | null,
    requester_email: string | null,
  ) => ({ required_role, required_users, requester_email });

  test("a role holder sees a foreign request their role must decide", () => {
    expect(inboxVisible(row("security", null, "dev@x"), "sec@x", ["security"])).toBe(true);
    expect(inboxVisible(row("security", null, "dev@x"), "sec@x", ["admin", "security"])).toBe(true);
  });

  test("a listed user sees a foreign request naming them", () => {
    expect(inboxVisible(row(null, ["boss@x"], "dev@x"), "boss@x", [])).toBe(true);
  });

  test("a non-listed, non-role user never sees it", () => {
    expect(inboxVisible(row("security", ["boss@x"], "dev@x"), "rev@x", ["reviewer"])).toBe(false);
    expect(inboxVisible(row(null, ["boss@x"], "dev@x"), "rev@x", [])).toBe(false);
  });

  test("the requester never sees their own request, even if role/user matches", () => {
    expect(inboxVisible(row("security", null, "sec@x"), "sec@x", ["security"])).toBe(false);
    expect(inboxVisible(row(null, ["boss@x"], "boss@x"), "boss@x", [])).toBe(false);
  });

  test("a request with no gate never routes to an inbox", () => {
    expect(inboxVisible(row(null, null, "dev@x"), "sec@x", ["security"])).toBe(false);
    expect(inboxVisible(row(null, [], "dev@x"), "sec@x", ["security"])).toBe(false);
  });

  test("an anonymous caller sees nothing", () => {
    expect(inboxVisible(row("security", ["boss@x"], "dev@x"), null, ["security"])).toBe(false);
  });

  test("a 'self'-only gate never routes to any inbox (the requester decides inline)", () => {
    // no one else is "self", and the requester never sees their own request
    expect(inboxVisible(row(null, ["self"], "dev@x"), "other@x", [])).toBe(false);
    expect(inboxVisible(row(null, ["self"], "dev@x"), "dev@x", [])).toBe(false);
    // but a role alongside "self" still routes to the role holder's inbox
    expect(inboxVisible(row("security", ["self"], "dev@x"), "sec@x", ["security"])).toBe(true);
  });
});
