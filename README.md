# neutron-authz

Embeddable TypeScript authorization engine: AWS-shape policy statements + grants-at-scope + typed
ABAC conditions, deny-wins, asymmetric fail-closed. Extracted from the neutron agent platform;
design: [designs/library-architecture.md](designs/library-architecture.md).

```text
src/
├── model/        statement, grant, condition, subject {kind,id}, scope shapes — THE SPEC
├── core/         pure evaluator (zero deps, no I/O) + validate/repair + SoD approvals
├── conformance/  golden JSON fixtures: every semantic as data-driven cases + runner
├── ports/        GrantStore · AuditSink · ScopeRoleSynthesizer · ActionRegistry ·
│                 ConditionKeys · SubjectDirectory
└── backends/pg/  reference Kysely adapter + migrations (authz_policies · authz_grants · authz_audit)
```

## Semantics (the contract)

- **Statement** `{effect, actions, resources, conditions?}` — actions from a closed host registry,
  NEVER wildcarded; resources exact or single trailing `*`; conditions typed
  `{operator, key,
  value}`, no expression language.
- **Grant** = (policy, subject `{kind,id}`, scope `{kind,id}`). A check evaluates against an
  ordered, host-resolved scope chain (root first): every grant at any chain scope applies — **deny
  anywhere beats allow anywhere**; nothing granted ⇒ deny.
- **Conditions** are tri-state (`match` / `no-match` / `unmatchable`) and **asymmetric
  fail-closed**: an allow contributes only on a definitive match; a deny fires on match AND on
  unmatchable (an unevaluable deny stays standing). Malformed input — scope chain, subjects,
  condition shapes — always denies.
- **Role synthesis**: app-owned role rows become grants at check time via `ScopeRoleSynthesizer` —
  one storage, no dual-write; synthesized grants join the same deny-wins union.
- Host keeps, permanently: authn → subjects resolution, admin-bypass decision (`bypass` check
  option), token minting, HTTP routes, admin UI, tool vocabulary/discovery.

## Consumers

Subpath exports point at raw `.ts` sources — intentional: the target hosts run Bun, which executes
TypeScript directly, so there is no build step and no drift between published types and code. A
consumer therefore needs a TS-aware runtime or bundler (Bun, or tsx/vite/esbuild-style tooling);
plain `node` cannot import this package as-is.

## Usage

```ts
import { AuthzMigrationProvider, PgAuthzStore } from "@bizfoundry/neutron-authz/backends/pg";
import { makeAuthz } from "@bizfoundry/neutron-authz/core";

const config = { scopeKinds: ["root", "space"], rootScope: { kind: "root", id: "*" } };
// Apply migrations into YOUR db (Kysely Migrator + AuthzMigrationProvider(config)),
// or fold authzMigrations(config) into your own chain.

const store = new PgAuthzStore(db, config);
const authz = makeAuthz({
  grantStore: store,
  auditSink: store,
  scopeKinds: config.scopeKinds,
  defaultScopeChain: [config.rootScope],
  conditionKeys: { "app:Email": { type: "string", lowercase: true } },
});

await authz.check(
  [{ kind: "user", id: "alice@example.com" }, { kind: "role", id: "ops" }],
  "docs.read",
  "doc:support",
  {
    scopeChain: [config.rootScope, { kind: "space", id: "s1" }],
    context: { "app:Email": "alice@example.com" },
  },
);
```

Policy writes go through `validateStatements(input, { isKnownAction, conditionKeys })` before the
store; AI drafts through `repairDraft`. Built-in condition keys (`request:Time`, `request:HourUTC`,
`request:SourceIp`) are populated by the engine; everything else is host-declared and host-populated
— a key with no honest value stays unpopulated (fails closed).

## Conformance

`src/conformance/cases/*.json` is the backend flip contract: language-neutral golden fixtures for
deny-wins, scope inheritance, resource matching, condition semantics, asymmetric fail-closed,
malformed-input, and role synthesis. Any alternative backend must decide every case identically
before an app flips config to it — see `tests/pg.test.ts` for the storage-backed runner template.
Cases marked `"storable": false` carry condition shapes the pg CHECK constraint refuses at rest; a
shape-checking backend asserts the rejection instead.

## Development

```sh
bun install
bun test              # pg suite needs DATABASE_URL (scratch db is created/dropped), e.g.:
                      #   docker run -d --name authz-pg -e POSTGRES_PASSWORD=x -p 5436:5432 postgres:18-alpine
                      #   echo 'DATABASE_URL=postgres://postgres:x@127.0.0.1:5436/postgres' > .env.test
bunx tsc --noEmit     # TypeScript 7 native typecheck
dprint fmt
```
