import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Migrator } from "kysely/migration";
import pg from "pg";
import {
  AuthzMigrationProvider,
  PgAuthzStore,
  SystemPolicyError,
} from "../src/backends/pg/index.js";
import {
  type ConformanceImpl,
  loadConformanceCases,
  memoryGrantSource,
} from "../src/conformance/index.js";
import { makeAuthz } from "../src/core/authz.js";
import type { AuditEvent } from "../src/ports/index.js";

// The reference pg backend, end to end on a scratch database: the migrations'
// CHECK constraints (the at-rest half of fail-closed), the store's CRUD
// contract, the audit sink, and — the point of the whole exercise — the FULL
// conformance suite decided through PgAuthzStore instead of the memory store.

const SCRATCH_DB = "neutron_authz_pg_test";
const baseUrl = process.env.AUTHZ_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error(
    "pg backend tests need AUTHZ_TEST_DATABASE_URL or DATABASE_URL "
      + `(a scratch database "${SCRATCH_DB}" is created and dropped)`,
  );
}
const adminUrl = new URL(baseUrl);
const scratchUrl = new URL(baseUrl);
scratchUrl.pathname = `/${SCRATCH_DB}`;

const ROOT = { kind: "root", id: "*" };
const SPACE = (id: string) => ({ kind: "space", id });
const CONFIG = { scopeKinds: ["root", "space"], rootScope: ROOT };

let db: Kysely<Record<string, Record<string, unknown>>>;
let migrator: Migrator;
let store: PgAuthzStore;

async function adminQuery(q: string): Promise<void> {
  const c = new pg.Client(adminUrl.toString());
  await c.connect();
  try {
    await c.query(q);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await adminQuery(`drop database if exists ${SCRATCH_DB}`);
  await adminQuery(`create database ${SCRATCH_DB}`);
  db = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: scratchUrl.toString() }),
    }),
  });
  migrator = new Migrator({ db, provider: new AuthzMigrationProvider(CONFIG) });
  const up = await migrator.migrateToLatest();
  expect(up.error).toBeUndefined();
  store = new PgAuthzStore(db, CONFIG);
});

afterAll(async () => {
  await db?.destroy();
  await adminQuery(`drop database if exists ${SCRATCH_DB}`);
});

async function truncate(): Promise<void> {
  await db.deleteFrom("authz_grants").execute();
  await db.deleteFrom("authz_policies").execute();
}

// ---------------------------------------------------------------------------
// At-rest CHECK constraints
// ---------------------------------------------------------------------------

describe("fail-closed at rest", () => {
  const rawGrant = (over: Record<string, unknown>) =>
    db.insertInto("authz_grants").values({
      id: crypto.randomUUID(),
      policy_id: crypto.randomUUID(),
      subject_kind: "user",
      subject_id: "evil",
      scope_kind: "root",
      scope_id: "*",
      ...over,
    }).execute();

  test("refuses an undeclared scope kind", () => {
    expect(rawGrant({ scope_kind: "galaxy", scope_id: "x" }))
      .rejects.toThrow(/authz_grants_scope_kind_check/);
  });

  test("refuses a root grant addressed by anything but the canonical root id", () => {
    expect(rawGrant({ scope_kind: "root", scope_id: "not-the-root" }))
      .rejects.toThrow(/authz_grants_root_scope_id_check/);
  });

  test("refuses a non-root grant addressed as the root id", () => {
    expect(rawGrant({ scope_kind: "space", scope_id: "*" }))
      .rejects.toThrow(/authz_grants_nonroot_scope_id_check/);
  });

  test("refuses non-array/non-object statement conditions shapes", async () => {
    for (const conditions of ["yes", 42, { operator: "StringEquals" }, ["scalar"], [["nested"]]]) {
      const insert = db.insertInto("authz_policies").values({
        id: crypto.randomUUID(),
        name: `shape-${crypto.randomUUID()}`,
        statements: JSON.stringify([
          { effect: "allow", actions: ["docs.read"], resources: ["*"], conditions },
        ]),
      }).execute();
      expect(insert).rejects.toThrow(/authz_policies_statement_conditions_shape_check/);
    }
  });

  test("accepts a well-shaped conditions array (the constraint is shape-only)", async () => {
    const p = await store.createPolicy({
      name: "shape-ok",
      description: null,
      statements: [{
        effect: "allow",
        actions: ["docs.read"],
        resources: ["*"],
        conditions: [{ operator: "StringEquals", key: "app:Source", value: "api" }],
      }],
      createdBy: null,
    });
    expect(p.statements[0]!.conditions!.length).toBe(1);
    await truncate();
  });
});

// ---------------------------------------------------------------------------
// The conformance suite through the pg store — the backend flip contract
// ---------------------------------------------------------------------------

const pgImpl: ConformanceImpl = async (c) => {
  await truncate();
  for (const g of c.grants) {
    const p = await store.createPolicy({
      name: g.policyName,
      description: null,
      statements: g.statements,
      createdBy: null,
    });
    await store.createGrant({
      policyId: p.id,
      subject: g.subject,
      scope: g.scope,
      createdBy: null,
    });
  }
  const authz = makeAuthz({
    grantStore: store,
    synthesizers: c.synthesizedGrants.length > 0 ? [memoryGrantSource(c.synthesizedGrants)] : [],
    conditionKeys: c.conditionKeys,
    scopeKinds: c.scopeKinds,
  });
  const allowed = await authz.check(c.check.subjects, c.check.action, c.check.resource, {
    scopeChain: c.check.scopeChain,
    context: c.check.context,
    sourceIp: c.check.sourceIp,
    now: c.check.now ? new Date(c.check.now) : undefined,
    silent: true,
  });
  return allowed ? "allow" : "deny";
};

describe("conformance through the pg store", () => {
  for (const c of loadConformanceCases()) {
    if (c.storable) {
      test(`${c.suite}: ${c.name}`, async () => {
        expect(await pgImpl(c)).toBe(c.expect);
      });
    } else {
      // A grant shape the at-rest constraint forbids: the store must REFUSE
      // to hold it at all — the row that would need fail-closed evaluation
      // can never exist in this backend.
      test(`${c.suite}: ${c.name} — unstorable shape is refused at rest`, async () => {
        await truncate();
        const bad = c.grants.find((g) =>
          g.statements.some((s) => s.conditions !== undefined && !Array.isArray(s.conditions))
          || g.statements.some((s) =>
            Array.isArray(s.conditions)
            && (s.conditions as unknown[]).some((x) =>
              typeof x !== "object" || x === null
              || Array.isArray(x)
            )
          )
        )!;
        expect(bad).toBeDefined();
        expect(store.createPolicy({
          name: bad.policyName,
          description: null,
          statements: bad.statements,
          createdBy: null,
        })).rejects.toThrow(/authz_policies_statement_conditions_shape_check/);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Store CRUD contract
// ---------------------------------------------------------------------------

describe("grant and policy CRUD", () => {
  const alice = { kind: "user", id: "crud-alice" };

  test("createGrant is idempotent and normalizes a root-kind scope to the canonical id", async () => {
    await truncate();
    const p = await store.createPolicy({
      name: "crud-read",
      description: null,
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
      createdBy: null,
    });
    await store.createGrant({ policyId: p.id, subject: alice, scope: ROOT, createdBy: null });
    await store.createGrant({ policyId: p.id, subject: alice, scope: ROOT, createdBy: null });
    await store.createGrant({
      policyId: p.id,
      subject: alice,
      scope: { kind: "root", id: "whatever" },
      createdBy: null,
    });
    const rows = await store.listGrants({ policyId: p.id });
    expect(rows.length).toBe(1);
    expect(rows[0]!.scope).toEqual(ROOT);
    expect(rows[0]!.policyName).toBe("crud-read");
  });

  test("attach/detach speak the flat shape over grant storage", async () => {
    await truncate();
    const p = await store.createPolicy({
      name: "crud-flat",
      description: null,
      statements: [{ effect: "allow", actions: ["usage.read"], resources: ["*"] }],
      createdBy: null,
    });
    await store.attachPolicy(p.id, alice);
    await store.attachPolicy(p.id, alice); // idempotent
    await store.attachPolicy(p.id, { kind: "role", id: "ops" });
    const atts = await store.listAttachments(p.id);
    expect(atts.length).toBe(2);
    expect(atts.some((a) => a.kind === "user" && a.id === alice.id)).toBe(true);

    expect(await store.detachPolicy(p.id, alice)).toBe(true);
    expect(await store.detachPolicy(p.id, alice)).toBe(false); // already gone
    expect((await store.listAttachments(p.id)).length).toBe(1);

    const summaries = await store.listPolicies();
    expect(summaries.find((s) => s.id === p.id)!.attachments).toEqual([
      { kind: "role", id: "ops" },
    ]);
  });

  test("deleteGrantsForSubject revokes at EVERY scope", async () => {
    await truncate();
    const p = await store.createPolicy({
      name: "crud-revoke",
      description: null,
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
      createdBy: null,
    });
    await store.createGrant({ policyId: p.id, subject: alice, scope: ROOT, createdBy: null });
    await store.createGrant({
      policyId: p.id,
      subject: alice,
      scope: SPACE("s1"),
      createdBy: null,
    });
    expect(await store.deleteGrantsForSubject(alice)).toBe(2);
    expect(await store.grantsFor([alice], [ROOT, SPACE("s1")])).toEqual([]);
  });

  test("deleteGrant by id; getGrant round-trip", async () => {
    await truncate();
    const p = await store.createPolicy({
      name: "crud-byid",
      description: null,
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
      createdBy: null,
    });
    await store.createGrant({
      policyId: p.id,
      subject: alice,
      scope: SPACE("s9"),
      createdBy: "admin@example.com",
    });
    const [g] = await store.listGrants({ scopeKind: "space", scopeId: "s9" });
    expect(g).toBeDefined();
    expect((await store.getGrant(g!.id))!.createdBy).toBe("admin@example.com");
    expect(await store.deleteGrant(g!.id)).toBe(true);
    expect(await store.deleteGrant(g!.id)).toBe(false);
    expect(await store.getGrant(g!.id)).toBeNull();
  });

  test("policy update/delete work for normal policies; deletePolicy removes its grants", async () => {
    await truncate();
    const p = await store.createPolicy({
      name: "crud-life",
      description: "v1",
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
      createdBy: null,
    });
    const updated = await store.updatePolicy(p.id, {
      name: "crud-life-2",
      description: "v2",
      statements: [{ effect: "allow", actions: ["docs.write"], resources: ["doc:*"] }],
    });
    expect(updated!.name).toBe("crud-life-2");
    expect(updated!.statements[0]!.actions).toEqual(["docs.write"]);

    await store.attachPolicy(p.id, alice);
    expect(await store.deletePolicy(p.id)).toBe(true);
    expect(await store.getPolicy(p.id)).toBeNull();
    expect(await store.listGrants({ policyId: p.id })).toEqual([]);
  });

  test("duplicatePolicy copies a policy's statements into a fresh editable one", async () => {
    await truncate();
    const p = await store.createPolicy({
      name: "crud-src",
      description: "the source",
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
      createdBy: null,
    });
    const copy = await store.duplicatePolicy(p.id, "crud-copy", "admin@example.com");
    expect(copy.name).toBe("crud-copy");
    expect(copy.statements).toEqual(p.statements);
    expect(copy.system).toBe(false);
    expect(store.duplicatePolicy(crypto.randomUUID(), "nope", null)).rejects.toThrow("not found");
  });

  test("a system policy is immutable: update and delete throw, duplicate stays open", async () => {
    await truncate();
    const id = crypto.randomUUID();
    // Only a host seed/migration mints a system policy — plant one raw.
    await db.insertInto("authz_policies").values({
      id,
      name: "crud-managed",
      statements: JSON.stringify([{ effect: "allow", actions: ["docs.read"], resources: ["*"] }]),
      system: true,
    }).execute();
    expect(store.updatePolicy(id, { name: "x", description: null, statements: [] }))
      .rejects.toThrow(SystemPolicyError);
    expect(store.deletePolicy(id)).rejects.toThrow(SystemPolicyError);
    const copy = await store.duplicatePolicy(id, "crud-managed-copy", null);
    expect(copy.system).toBe(false);
  });

  test("a duplicate policy name is refused by the unique constraint", async () => {
    await truncate();
    await store.createPolicy({
      name: "crud-unique",
      description: null,
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
      createdBy: null,
    });
    expect(store.createPolicy({
      name: "crud-unique",
      description: null,
      statements: [{ effect: "allow", actions: ["docs.read"], resources: ["*"] }],
      createdBy: null,
    })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Audit sink
// ---------------------------------------------------------------------------

describe("audit through the pg sink", () => {
  const auditor = { kind: "user", id: "audit-alice" };

  test("check decisions land in authz_audit with scope detail; silent skips; executed records", async () => {
    await truncate();
    const p = await store.createPolicy({
      name: "audit-allow",
      description: null,
      statements: [{ effect: "allow", actions: ["usage.read"], resources: ["*"] }],
      createdBy: null,
    });
    await store.attachPolicy(p.id, auditor);
    const authz = makeAuthz({
      grantStore: store,
      scopeKinds: ["root", "space"],
      defaultScopeChain: [ROOT],
      auditSink: store,
    });

    const probe = `probe-${crypto.randomUUID()}`;
    await authz.check([auditor], "usage.read", probe, {
      scopeChain: [ROOT, SPACE("s1")],
      auditDetail: { scope: SPACE("s1") },
      source: "admin-api",
    });
    await authz.check([auditor], "usage.read", probe);
    await authz.check([auditor], "secrets.read", probe); // nothing granted ⇒ deny
    await authz.check([auditor], "usage.read", probe, { silent: true });
    await authz.check([], "usage.read", probe); // anonymous
    store.record(
      {
        subjects: [auditor],
        action: "usage.read",
        resource: probe,
        decision: "executed",
        source: "admin-api",
        detail: null,
      } satisfies AuditEvent,
    );
    await store.flushAudit();

    const rows = (await store.listAudit({ limit: 200 })).filter((r) => r.resource === probe);
    expect(rows.length).toBe(5); // the silent check wrote nothing
    const scoped = rows.find((r) => r.detail !== null)!;
    expect(scoped.decision).toBe("allow");
    expect(scoped.source).toBe("admin-api");
    expect(scoped.detail).toEqual({ scope: { kind: "space", id: "s1" } });
    expect(rows.filter((r) => r.decision === "deny").length).toBe(2); // secrets + anonymous
    const anon = rows.find((r) => r.subject.kind === "anonymous")!;
    expect(anon.subject.id).toBe("anonymous");
    expect(rows.some((r) => r.decision === "executed")).toBe(true);

    // Filters: substring on subject id, exact-ish on action.
    const mine = await store.listAudit({ subjectId: "audit-ali", limit: 200 });
    expect(mine.every((r) => r.subject.id.includes("audit-ali"))).toBe(true);
  });

  test("sweepAudit removes rows past the retention window and nothing else", async () => {
    const old = crypto.randomUUID();
    await db.insertInto("authz_audit").values({
      id: old,
      at: sql`now() - interval '100 days'`,
      subject_kind: "user",
      subject_id: "audit-old",
      action: "usage.read",
      resource: "r",
      decision: "allow",
      source: "api",
    }).execute();
    const removed = await store.sweepAudit();
    expect(removed).toBeGreaterThanOrEqual(1);
    const gone = await store.listAudit({ subjectId: "audit-old", limit: 10 });
    expect(gone.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Down migration (keep LAST — it drops the schema)
// ---------------------------------------------------------------------------

describe("migration rollback", () => {
  test("down drops the tables and function; up again is clean", async () => {
    const down = await migrator.migrateDown();
    expect(down.error).toBeUndefined();
    const tables = await db.introspection.getTables();
    for (const t of ["authz_policies", "authz_grants", "authz_audit"]) {
      expect(tables.some((x) => x.name === t)).toBe(false);
    }
    const again = await migrator.migrateToLatest();
    expect(again.error).toBeUndefined();
    const after = await db.introspection.getTables();
    expect(after.some((x) => x.name === "authz_policies")).toBe(true);
  });
});
