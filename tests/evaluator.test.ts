import { describe, expect, test } from "bun:test";
import { memoryGrantSource, MemoryGrantStore } from "../src/conformance/index.js";
import { makeAuthz } from "../src/core/authz.js";
import type { ResolvedGrant } from "../src/model/grant.js";
import type { AuditEvent } from "../src/ports/index.js";

// The composed engine over the in-memory reference store: the ports wiring
// (bypass, audit, default chain, synthesizer union) that the data-driven
// conformance fixtures deliberately leave to code-level tests.

const ROOT = { kind: "root", id: "*" };
const SPACE = (id: string) => ({ kind: "space", id });
const alice = { kind: "user", id: "alice" };

function grant(
  subject: ResolvedGrant["subject"],
  scope: ResolvedGrant["scope"],
  statements: ResolvedGrant["statements"],
  name = "p",
): ResolvedGrant {
  return { policyId: name, policyName: name, subject, scope, statements };
}

function makeStore(grants: ResolvedGrant[]): MemoryGrantStore {
  const store = new MemoryGrantStore(ROOT);
  for (const g of grants) store.seed(g);
  return store;
}

describe("bypass and audit wiring", () => {
  test("bypass short-circuits policy entirely — even a matching deny — and audits admin_bypass", async () => {
    const events: AuditEvent[] = [];
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "deny", actions: ["docs.read"], resources: ["*"] }]),
      ]),
      defaultScopeChain: [ROOT],
      auditSink: { record: (e) => void events.push(e) },
    });
    expect(await authz.check([alice], "docs.read", "doc:x", { bypass: true })).toBe(true);
    // ...and the same principal without bypass is denied by that deny.
    expect(await authz.check([alice], "docs.read", "doc:x")).toBe(false);
    expect(events.map((e) => e.decision)).toEqual(["admin_bypass", "deny"]);
  });

  test("every evaluation is audited exactly once, with source and detail threaded through", async () => {
    const events: AuditEvent[] = [];
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }]),
      ]),
      scopeKinds: ["root", "space"],
      defaultScopeChain: [ROOT],
      auditSink: { record: (e) => void events.push(e) },
    });

    await authz.check([alice], "docs.read", "doc:x", {
      source: "admin-api",
      scopeChain: [ROOT, SPACE("s1")],
      auditDetail: { scope: { kind: "space", id: "s1" } },
    });
    await authz.check([alice], "docs.read", "doc:x");
    expect(events.length).toBe(2);
    expect(events[0]).toMatchObject({
      decision: "allow",
      source: "admin-api",
      detail: { scope: { kind: "space", id: "s1" } },
    });
    expect(events[1]).toMatchObject({ decision: "allow", source: "api", detail: null });
    expect(events[0]!.subjects).toEqual([alice]);
  });

  test("a fail-closed deny on a malformed chain still audits, carrying the caller's detail", async () => {
    const events: AuditEvent[] = [];
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }]),
      ]),
      scopeKinds: ["root", "space"],
      defaultScopeChain: [ROOT],
      auditSink: { record: (e) => void events.push(e) },
    });
    const bad = { kind: "warpzone", id: "x" };
    expect(
      await authz.check([alice], "docs.read", "doc:x", {
        scopeChain: [ROOT, bad],
        auditDetail: { scope: bad },
      }),
    ).toBe(false);
    expect(events[0]).toMatchObject({ decision: "deny", detail: { scope: bad } });
  });

  test("silent skips the audit row", async () => {
    const events: AuditEvent[] = [];
    const authz = makeAuthz({
      grantStore: makeStore([]),
      defaultScopeChain: [ROOT],
      auditSink: { record: (e) => void events.push(e) },
    });
    await authz.check([alice], "docs.read", "doc:x", { silent: true });
    await authz.check([alice], "docs.read", "doc:x", { silent: true, bypass: true });
    expect(events).toEqual([]);
  });
});

describe("default scope chain", () => {
  test("an unscoped check evaluates at the default chain (root grants only)", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }]),
        grant(alice, SPACE("s1"), [{ effect: "allow", actions: ["docs.write"], resources: ["*"] }]),
      ]),
      scopeKinds: ["root", "space"],
      defaultScopeChain: [ROOT],
    });
    expect(await authz.check([alice], "docs.read", "doc:x")).toBe(true);
    // The leaf grant needs its chain named; the default never includes it.
    expect(await authz.check([alice], "docs.write", "doc:x")).toBe(false);
    expect(await authz.check([alice], "docs.write", "doc:x", { scopeChain: [ROOT, SPACE("s1")] }))
      .toBe(true);
  });

  test("without a default chain, an unscoped check matches no grants at all", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }]),
      ]),
    });
    expect(await authz.check([alice], "docs.read", "doc:x")).toBe(false);
  });
});

describe("synthesizer union", () => {
  test("synthesized grants union with stored ones under one deny-wins pass", async () => {
    const synthesized = memoryGrantSource([
      grant(alice, SPACE("s1"), [
        { effect: "allow", actions: ["space.approvals.settle"], resources: ["*"] },
      ], "SynthAdmin"),
    ]);
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [
          { effect: "deny", actions: ["space.approvals.settle"], resources: ["res:locked"] },
        ]),
      ]),
      scopeKinds: ["root", "space"],
      defaultScopeChain: [ROOT],
      synthesizers: [synthesized],
    });
    const chain = { scopeChain: [ROOT, SPACE("s1")] };
    expect(await authz.check([alice], "space.approvals.settle", "res:open", chain)).toBe(true);
    // The stored deny still beats the synthesized allow.
    expect(await authz.check([alice], "space.approvals.settle", "res:locked", chain)).toBe(false);
    // The synthesized grant is confined to its scope.
    expect(await authz.check([alice], "space.approvals.settle", "res:open")).toBe(false);
  });

  test("listGrantsFor unions stored and synthesized grants for a 'why' view", async () => {
    const synthesized = memoryGrantSource([
      grant(alice, SPACE("s1"), [
        { effect: "allow", actions: ["space.participate"], resources: ["*"] },
      ], "SynthMember"),
    ]);
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }], "Read"),
      ]),
      scopeKinds: ["root", "space"],
      defaultScopeChain: [ROOT],
      synthesizers: [synthesized],
    });
    const atRoot = await authz.listGrantsFor([alice]);
    expect(atRoot.map((g) => g.policyName)).toEqual(["Read"]);
    const inSpace = await authz.listGrantsFor([alice], [ROOT, SPACE("s1")]);
    expect(inSpace.map((g) => g.policyName).sort()).toEqual(["Read", "SynthMember"]);
    expect(inSpace.find((g) => g.policyName === "SynthMember")!.scope).toEqual(SPACE("s1"));
  });

  test("listGrantsFor fails closed on a malformed or undeclared chain, like check()", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }]),
      ]),
      scopeKinds: ["root", "space"],
      defaultScopeChain: [ROOT],
    });
    expect((await authz.listGrantsFor([alice])).length).toBe(1);
    for (const bad of [{ kind: "galaxy", id: "x" }, { kind: "space", id: "" }, "space:s1", null]) {
      expect(await authz.listGrantsFor([alice], [ROOT, bad as never])).toEqual([]);
    }
  });
});

describe("memory store contract", () => {
  test("createGrant is idempotent and normalizes a root-kind scope to the canonical id", async () => {
    const store = new MemoryGrantStore(ROOT);
    store.addPolicy({
      id: "p1",
      name: "read",
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
    });
    await store.createGrant({ policyId: "p1", subject: alice, scope: ROOT, createdBy: null });
    await store.createGrant({ policyId: "p1", subject: alice, scope: ROOT, createdBy: null });
    await store.createGrant({
      policyId: "p1",
      subject: alice,
      scope: { kind: "root", id: "something-else" },
      createdBy: null,
    });
    expect((await store.grantsFor([alice], [ROOT])).length).toBe(1);
  });

  test("deleteGrantsForSubject revokes at EVERY scope", async () => {
    const store = new MemoryGrantStore(ROOT);
    store.addPolicy({
      id: "p1",
      name: "read",
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
    });
    await store.createGrant({ policyId: "p1", subject: alice, scope: ROOT, createdBy: null });
    await store.createGrant({
      policyId: "p1",
      subject: alice,
      scope: SPACE("s1"),
      createdBy: null,
    });
    expect(await store.deleteGrantsForSubject(alice)).toBe(2);
    expect(await store.grantsFor([alice], [ROOT, SPACE("s1")])).toEqual([]);
  });
});

describe("checkDetailed — allow provenance (v0.1.1)", () => {
  // Model neutron's open-mode baseline: a synthesizer that allows agent.use on
  // everything for EVERY caller, unconditionally (like accessModeSynthesizer —
  // it returns the grant regardless of subject; check() trusts synthesizer
  // output without re-filtering by subject). The visibility gate needs to tell
  // an EXPLICIT stored grant apart from this ambient allow.
  const openBaseline = {
    async grantsFor(): Promise<ResolvedGrant[]> {
      return [
        grant({ kind: "mode", id: "open" }, ROOT, [
          { effect: "allow", actions: ["agent.use"], resources: ["agent:*"] },
        ], "OpenMode"),
      ];
    },
  };

  test("allowed only by the synthesizer ⇒ allowed, but not by stored grants", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([]),
      defaultScopeChain: [ROOT],
      synthesizers: [openBaseline],
    });
    const d = await authz.checkDetailed([alice], "agent.use", "agent:heal");
    expect(d.allowed).toBe(true);
    expect(d.decision).toBe("allow");
    expect(d.allowedByStoredGrants).toBe(false);
  });

  test("an explicit stored allow ⇒ allowedByStoredGrants true", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{
          effect: "allow",
          actions: ["agent.use"],
          resources: ["agent:heal"],
        }]),
      ]),
      defaultScopeChain: [ROOT],
      synthesizers: [openBaseline],
    });
    const d = await authz.checkDetailed([alice], "agent.use", "agent:heal");
    expect(d.allowed).toBe(true);
    expect(d.allowedByStoredGrants).toBe(true);
  });

  test("a stored deny beats both the synthesizer and any stored allow", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{ effect: "deny", actions: ["agent.use"], resources: ["agent:heal"] }]),
      ]),
      defaultScopeChain: [ROOT],
      synthesizers: [openBaseline],
    });
    const d = await authz.checkDetailed([alice], "agent.use", "agent:heal");
    expect(d.allowed).toBe(false);
    expect(d.decision).toBe("deny");
    expect(d.allowedByStoredGrants).toBe(false);
  });

  test("bypass ⇒ admin_bypass + allowed, still reporting the real stored verdict", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([]),
      defaultScopeChain: [ROOT],
      synthesizers: [openBaseline],
    });
    const d = await authz.checkDetailed([alice], "agent.use", "agent:heal", { bypass: true });
    expect(d.decision).toBe("admin_bypass");
    expect(d.allowed).toBe(true);
    expect(d.allowedByStoredGrants).toBe(false);
  });

  test("a malformed scope chain fails closed (no stored allow reported)", async () => {
    const authz = makeAuthz({
      grantStore: makeStore([
        grant(alice, ROOT, [{
          effect: "allow",
          actions: ["agent.use"],
          resources: ["agent:heal"],
        }]),
      ]),
      scopeKinds: ["root"],
      defaultScopeChain: [ROOT],
    });
    const d = await authz.checkDetailed([alice], "agent.use", "agent:heal", {
      scopeChain: [{ kind: "space", id: "nope" }],
    });
    expect(d.allowed).toBe(false);
    expect(d.allowedByStoredGrants).toBe(false);
  });
});
