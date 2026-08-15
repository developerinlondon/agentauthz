---
title: Storage & conformance
weight: 10
icon: database
---

## The pg backend

`backends/pg` is the reference implementation on Kysely + Postgres, and the only one shipped. It
owns three tables in **your** database — never a separate authz DB:

| Table            | Holds                                                            |
| ---------------- | ---------------------------------------------------------------- |
| `authz_policies` | named statement bundles (jsonb), `system` flag for managed ones  |
| `authz_grants`   | _(policy, subject, scope)_ + optional `bounds` jsonb             |
| `authz_audit`    | one row per decision: subject, action, resource, verdict, source |

```ts
import { PgAuthzStore } from "agentauthz/backends/pg";

const store = new PgAuthzStore(db, {
  scopeKinds: ["root", "project"],
  rootScope: { kind: "root", id: "*" },
  auditRetentionDays: 90, // swept probabilistically on insert
});
```

The store is also the `AuditSink`: audit writes are fire-and-forget — an audit outage must never
break authorization — with `flushAudit()` for tests and shutdown.

CHECK constraints are the **at-rest** half of fail-closed: only declared scope kinds may be stored,
the root scope is always addressed by its canonical id, and statement/bounds shapes are guarded.
They are shape-only on purpose, so the operator whitelist can grow without a migration.

## Migrations

```ts
import { applyAuthzMigrations, AuthzMigrationProvider } from "agentauthz/backends/pg";

// standalone, via Kysely's Migrator:
new Migrator({ db, provider: new AuthzMigrationProvider(config) });

// or folded into your own migration chain:
await applyAuthzMigrations(db, config);
```

{{< callout type="warning" >}} **Run every migration, never a named one.** `authzMigrations(config)`
returns a record, and a host that hardcodes `["0001_authz"]` silently skips everything added later —
the failure surfaces at runtime as a missing column, not at deploy. `applyAuthzMigrations` /
`revertAuthzMigrations` exist so that cannot happen. Each migration is idempotent, so a squashed
baseline on fresh databases and a delta on live ones converge. {{< /callout >}}

## Bringing your own storage

The engine never touches a database directly — it calls the `GrantStore` port. A backend is
five methods over whatever you have (SQLite, Dynamo, MySQL, memory, an HTTP service):

```ts
interface GrantStore {
  grantsFor(subjects: Subject[], scopeChain: ScopeChain): Promise<ResolvedGrant[]>;
  createGrant(input: { policyId; subject; scope; bounds?; createdBy }): Promise<void>;
  deleteGrant(id: string): Promise<boolean>;
  deleteGrantsForSubject(subject: Subject): Promise<number>;
  deleteGrantsForPolicy(policyId: string): Promise<number>;
}
```

`grantsFor` is the only one evaluation calls: return exactly the grants whose subject AND scope
match — over-returning is a correctness bug, not a widening, but the contract is precise and
the fixtures below check it for you. Wire it in and nothing else changes:

```ts
const authz = makeAuthz({ grantStore: myStore, /* …identical otherwise */ });
```

The [cookbook](../cookbook)'s in-memory store is a complete working backend in about a hundred
lines — the honest measure of the port's size.

## Conformance

`conformance/cases/*.json` is the backend contract: language-neutral golden fixtures covering
deny-wins, scope inheritance, resource matching, every condition semantic, asymmetric fail-closed,
malformed input, role synthesis, action derivation, set membership, and grant bounds.

```ts
import { composedEngineImpl, runConformance } from "agentauthz/conformance";

const results = await runConformance(composedEngineImpl);
// every result.pass must be true
```

Two reference implementations run every case: the pure evaluator over a raw grant list, and a
composed engine over an in-memory store. To prove an **alternative backend** (another store, another
language), run the same cases through it — every decision must be identical before an app flips
config to it. The shipped pg suite is the template: it seeds each case's grants through the real
store and asserts the same verdicts.

Cases marked `"storable": false` carry condition shapes the pg CHECK constraint refuses at rest; a
shape-checking backend asserts the _rejection_ instead of the decision.

There is a second fixture for the admin contract: `conformance/descriptor/` holds a known vocabulary
and the exact descriptor document it must produce, so a change to the shape is a deliberate act
rather than a surprise for every UI downstream.
