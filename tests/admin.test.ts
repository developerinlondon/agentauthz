import { beforeEach, describe, expect, test } from "bun:test";
import { createAdminHandler } from "../src/admin/index.js";
import type { AdminAuditRecord, AdminStore } from "../src/admin/types.js";
import { describeAuthz } from "../src/core/describe.js";
import type { GrantRecord, PolicyRecord } from "../src/model/grant.js";
import { actionRegistryFromCatalogue } from "../src/ports/index.js";

const descriptor = describeAuthz({
  actionRegistry: actionRegistryFromCatalogue([
    { action: "widgets.read" },
    { action: "widgets.write", derivesFrom: "widgets.read" },
  ]),
  conditionKeys: { "app:Region": { type: "string" }, "app:MaxCpu": { type: "number" } },
  scopeKinds: ["root", "space"],
});

interface Created {
  policyId: string;
  subject: { kind: string; id: string; };
  scope: { kind: string; id: string; };
  bounds?: unknown;
  createdBy: string | null;
}

let created: Created[];
let deleted: string[];
let audit: AdminAuditRecord[];

const store: AdminStore = {
  listGrants: async (filter) =>
    [
      {
        id: "g1",
        policyId: "p1",
        policyName: "reader",
        subject: { kind: "user", id: "alice" },
        scope: { kind: "root", id: "*" },
        createdBy: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ].filter((g) => !filter.subjectId || g.subject.id === filter.subjectId) as GrantRecord[],
  createGrant: async (input) => {
    created.push(input as Created);
  },
  deleteGrant: async (id) => {
    deleted.push(id);
    return id === "g1";
  },
  listPolicies: async () =>
    [{
      id: "p1",
      name: "reader",
      description: null,
      statements: [{ effect: "allow", actions: ["widgets.read"], resources: ["*"] }],
      system: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }] as PolicyRecord[],
  listAudit: async () => audit,
};

// A sink that lands writes in the same list GET /audit reads, so the test can
// assert the round trip rather than that record() was merely called.
let nextAuditId = 1;
const auditSink = {
  record: (e: {
    subjects: readonly { kind: string; id: string; }[];
    action: string;
    resource: string;
    decision: string;
    source: string;
    detail: Record<string, unknown> | null;
  }) => {
    audit.unshift({
      id: `a${nextAuditId++}`,
      at: new Date(0).toISOString(),
      subject: e.subjects[0] ?? { kind: "anonymous", id: "anonymous" },
      action: e.action,
      resource: e.resource,
      decision: e.decision,
      source: e.source,
      detail: e.detail,
    });
  },
};

const handler = createAdminHandler({
  descriptor,
  store,
  basePath: "/api/v1/authz",
  actor: () => ({ kind: "user", id: "admin@example.com" }),
  auditSink,
  subjects: {
    list: async ({ q }) =>
      [{ kind: "user", id: "alice", label: "Alice" }].filter((s) => !q || s.id.includes(q)),
  },
});

const get = (path: string) => handler(new Request(`https://host${path}`));
const post = (path: string, body: unknown) =>
  handler(
    new Request(`https://host${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  created = [];
  deleted = [];
  audit = [];
});

describe("admin handlers speak plain Request/Response", () => {
  test("GET /descriptor serves the document a UI binds to", async () => {
    const res = await get("/api/v1/authz/descriptor");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(descriptor);
  });

  test("routes outside the mount prefix are not found", async () => {
    expect((await get("/elsewhere/descriptor")).status).toBe(404);
  });

  test("GET /grants passes filters through", async () => {
    expect((await (await get("/api/v1/authz/grants?subjectId=alice")).json() as unknown[]).length)
      .toBe(1);
    expect((await (await get("/api/v1/authz/grants?subjectId=bob")).json() as unknown[]).length)
      .toBe(0);
  });

  test("GET /policies and /audit are read-only listings", async () => {
    expect((await (await get("/api/v1/authz/policies")).json() as PolicyRecord[])[0]!.name)
      .toBe("reader");
    expect(await (await get("/api/v1/authz/audit")).json()).toEqual([]);
  });

  test("GET /subjects reports 501 when the host exposes no directory", async () => {
    const bare = createAdminHandler({ descriptor, store });
    const res = await bare(new Request("https://host/subjects"));
    expect(res.status).toBe(501);
  });

  test("DELETE /grants/:id revokes, and a missing one is 404", async () => {
    expect(
      (await handler(
        new Request("https://host/api/v1/authz/grants/g1", { method: "DELETE" }),
      )).status,
    ).toBe(200);
    expect(deleted).toEqual(["g1"]);
    expect(
      (await handler(
        new Request("https://host/api/v1/authz/grants/nope", { method: "DELETE" }),
      )).status,
    ).toBe(404);
  });
});

describe("admin writes validate at the boundary", () => {
  const base = {
    policyId: "p1",
    subject: { kind: "user", id: "alice" },
    scope: { kind: "space", id: "acme" },
  };

  test("a well-formed grant is created, with the host's actor recorded", async () => {
    const res = await post("/api/v1/authz/grants", {
      ...base,
      bounds: [{ operator: "StringEquals", key: "app:Region", value: "eu-west" }],
    });
    expect(res.status).toBe(201);
    expect(created[0]!.createdBy).toBe("admin@example.com");
    expect(created[0]!.bounds).toEqual([
      { operator: "StringEquals", key: "app:Region", value: "eu-west" },
    ]);
  });

  test("an undeclared scope kind is refused", async () => {
    const res = await post("/api/v1/authz/grants", { ...base, scope: { kind: "galaxy", id: "x" } });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string; }).error).toContain("galaxy");
    expect(created).toEqual([]);
  });

  test("a rejected bound names the offending condition, in the engine's own words", async () => {
    const res = await post("/api/v1/authz/grants", {
      ...base,
      bounds: [{ operator: "StringEquals", key: "app:Nope", value: "x" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string; }).error).toBe(
      'condition 0: unknown key "app:Nope"',
    );
    expect(created).toEqual([]);
  });

  test("an operator the key's type forbids is refused before it can be stored", async () => {
    const res = await post("/api/v1/authz/grants", {
      ...base,
      bounds: [{ operator: "NumericLessThan", key: "app:Region", value: "4" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string; }).error).toContain("cannot test app:Region");
    expect(created).toEqual([]);
  });

  test("a set operator carrying a scalar bound is refused", async () => {
    const res = await post("/api/v1/authz/grants", {
      ...base,
      bounds: [{ operator: "StringIn", key: "app:Region", value: "eu-west" }],
    });
    expect(res.status).toBe(400);
    expect(created).toEqual([]);
  });

  test("creating and revoking are observable through GET /audit", async () => {
    await post("/api/v1/authz/grants", base);
    await handler(new Request("https://host/api/v1/authz/grants/g1", { method: "DELETE" }));

    const rows = await (await get("/api/v1/authz/audit")).json() as AdminAuditRecord[];
    expect(rows.map((r) => r.action)).toEqual(["authz.grant.revoke", "authz.grant.create"]);
    expect(rows.every((r) => r.subject.id === "admin@example.com")).toBe(true);
    expect(rows.every((r) => r.decision === "executed")).toBe(true);
    const create = rows.find((r) => r.action === "authz.grant.create")!;
    expect(create.detail).toMatchObject({ scope: { kind: "space", id: "acme" } });
  });

  test("a refused write leaves no audit trace", async () => {
    await post("/api/v1/authz/grants", { ...base, scope: { kind: "galaxy", id: "x" } });
    expect(await (await get("/api/v1/authz/audit")).json()).toEqual([]);
  });

  test("a malformed body never reaches the store", async () => {
    for (
      const body of [
        {},
        { ...base, subject: "alice" },
        { ...base, scope: null },
        { ...base, bounds: "eu-west" },
      ]
    ) {
      expect((await post("/api/v1/authz/grants", body)).status).toBe(400);
    }
    expect(created).toEqual([]);
  });
});
