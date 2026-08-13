# @neutroncore/authz

Embeddable TypeScript authorization engine: policy statements + grants-at-scope + typed ABAC
conditions, deny-wins, asymmetric fail-closed. **Policies are rows in your own database**, authored
at runtime — by an admin UI, or by an agent — not files compiled into a deployment.

```sh
npm install @neutroncore/authz     # or: bun add / pnpm add / yarn add
```

Ships compiled ESM with type declarations, so plain Node (>=20) can consume it — no TypeScript
runtime or bundler required. `kysely` is an optional peer, needed only for the Postgres backend:

```sh
npm install @neutroncore/authz kysely
```

```text
src/
├── model/        statement, grant, condition, subject {kind,id}, scope shapes — THE SPEC
├── core/         pure evaluator (zero deps, no I/O) + validate/repair + SoD approvals
├── conformance/  golden JSON fixtures: every semantic as data-driven cases + runner
├── ports/        GrantStore · AuditSink · ScopeRoleSynthesizer · ActionRegistry ·
│                 ConditionKeys · SubjectDirectory
└── backends/pg/  reference Kysely adapter + migrations (authz_policies · authz_grants · authz_audit)
```

## Why this exists

Most authorization libraries are evaluators: you hand them policies and entities, they return a
decision, and storage is your problem. That is the right split when policies are written by
developers and shipped in git. It is the wrong split when policies are data — written by admins
through a UI, or drafted by an agent — because then you need a schema, migrations, validation on
write, and an audit trail, and you end up building those anyway.

This ships both halves, in-process, against your own Postgres. No extra service, no network hop, no
cache-invalidation webhook, no fail-open-when-the-PDP-is-down question.

**Use Cedar instead** if your policies live in git and you want a formally verified evaluator — it
is excellent, and it is a component rather than a solution. **Use OpenFGA or SpiceDB instead** if
your model is relationship-based (ReBAC) rather than statement-based, and you can run another
stateful service.

## Semantics (the contract)

- **Statement** `{effect, actions, resources, conditions?}` — actions from a closed host registry,
  NEVER wildcarded; resources exact or single trailing `*`; conditions typed
  `{operator, key, value}` (or `values` for set operators), no expression language.
- **Grant** = (policy, subject `{kind,id}`, scope `{kind,id}`). A check evaluates against an
  ordered, host-resolved scope chain (root first): every grant at any chain scope applies — **deny
  anywhere beats allow anywhere**; nothing granted ⇒ deny.
- **Conditions** are tri-state (`match` / `no-match` / `unmatchable`) and **asymmetric
  fail-closed**: an allow contributes only on a definitive match; a deny fires on match AND on
  unmatchable (an unevaluable deny stays standing). Malformed input — scope chain, subjects,
  condition shapes — always denies.
- **Role synthesis**: app-owned role rows become grants at check time via `ScopeRoleSynthesizer` —
  one storage, no dual-write; synthesized grants join the same deny-wins union.
- The host keeps, permanently: authn → subjects resolution, admin-bypass decision (`bypass` check
  option), token minting, HTTP routes, admin UI, action vocabulary.

A flat model is supported: leave `scopeKinds` unset and pass a single root scope as
`defaultScopeChain`. The hierarchy is available, not mandatory.

## Conditions

Conditions are typed triples, never expressions. Scalar operators read `value`; set operators read
`values`. Exactly one is populated — a condition carrying both is unmatchable rather than a guess at
which the author meant.

| Operator                                 | Bound    | Key type | Notes                                                    |
| ---------------------------------------- | -------- | -------- | -------------------------------------------------------- |
| `StringEquals` / `StringNotEquals`       | `value`  | string   | array context ⇒ set-wise                                 |
| `StringLike`                             | `value`  | string   | **exact, or one trailing `*`** — not a glob, not a regex |
| `StringIn` / `StringNotIn`               | `values` | string   | membership; `StringNotIn` is the exact negation          |
| `StringLikeIn`                           | `values` | string   | membership across trailing-`*` prefix patterns           |
| `NumericLessThan` / `NumericGreaterThan` | `value`  | number   | **the bound is a string**: `"5"`, not `5`                |
| `DateLessThan` / `DateGreaterThan`       | `value`  | date     | value must carry `Z` or an explicit offset               |
| `IpAddress` / `NotIpAddress`             | `value`  | ip       | CIDR membership, IPv4 and IPv6                           |

Two shapes read as working policies but are not, so they are called out rather than left to be
discovered: `StringLike` is **prefix-only**, so `"infra|lite"` is a literal string that matches
nothing; and a numeric bound is a **string**, so `value: 5` is a type error that yields an
unmatchable condition rather than a loud failure. Both are rejected by `validateStatements` on the
write path.

An allowlist is one condition, not one statement per permitted value:

```ts
conditions: [
  { operator: "StringIn", key: "app:Pool", values: ["infra", "lite"] },
  { operator: "StringEquals", key: "app:Registry", value: "registry.example.com" },
];
```

With a list on both sides — a policy list and a multi-valued context key — the semantic is a
**non-empty intersection**: the request holds at least one permitted value. `StringNotIn` is its
exact negation, true only when nothing intersects. An empty `values` list is rejected at write time
and unmatchable at evaluation, so it can never read as a vacuous allow.

## Action derivation

A host with a large action vocabulary would otherwise enumerate every action in every statement that
morally covers it — so adding an endpoint means revisiting every policy, and the failure is silent
in both directions. A host may instead declare that one action derives from another:

```ts
import { actionRegistryFromCatalogue } from "@neutroncore/authz/ports";

const actions = actionRegistryFromCatalogue([
  { action: "edit" },
  { action: "docs.update", derivesFrom: "edit" },
  { action: "docs.delete", derivesFrom: "docs.update" },
]);

actions.descendantsOf("edit"); // ["docs.delete", "docs.update"]
```

A statement naming `edit` now covers both, transitively. Three properties make this safe:

- **It is not a wildcard.** A wildcard matches unknown and future actions; a derivation expands to a
  declared, closed, enumerable set whose every member `isKnownAction` still gates. `descendantsOf`
  lists exactly what a statement permits, so a UI can render the 21 actions rather than `edit *`.
- **Deny expands exactly as allow does.** A deny naming `edit` stops everything deriving from it.
  The alternative — deny matching exactly while allow expands — would make deny narrower than allow
  and invert the engine's posture.
- **Derivation is registry data, not policy data.** A policy author, human or model, cannot invent
  one. The catalogue rejects cycles, self-derivation and unknown parents when it is built.

Derivation never runs downward or sideways: granting `docs.delete` does not grant `edit`, and a
separate tree is untouched. Actions are single-parent, because deny expands too — multiple parents
would let a deny on any ancestor silently kill a leaf.

If an ancestry cannot be resolved (a cycle reaching a hand-rolled `parentOf`), the match is
`unresolvable` rather than absent, and it resolves asymmetrically like a condition: an allow needs a
definitive match, a deny fires anyway. A deny never stops covering its leaves because a lookup
misbehaved.

## Untrusted policy authors

The engine has no expression language on purpose. Actions come from a closed registry the host
declares, resources take at most one trailing wildcard, and conditions are typed triples — so a
policy author cannot smuggle in evaluation logic.

That makes agent-drafted policy tractable:

```ts
import { repairDraft, validateStatements } from "@neutroncore/authz/core";

// Model output is never trusted. Hallucinated actions and unknown resources are
// dropped statement-by-statement; a draft left with no statements is rejected.
const draft = repairDraft(modelJson, { isKnownAction, isKnownResource, conditionKeys });
if (!draft.ok) return reject(draft.error);

// Then the same validation every write path uses, before it reaches the store.
const check = validateStatements(draft.statements, { isKnownAction, conditionKeys });
```

An agent-written `deny` that cannot be evaluated still denies — it is not skipped. That is a
deliberate divergence from Cedar, which ignores erroring policies in both directions.

## Usage

```ts
import { AuthzMigrationProvider, PgAuthzStore } from "@neutroncore/authz/backends/pg";
import { makeAuthz } from "@neutroncore/authz/core";

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

Built-in condition keys (`request:Time`, `request:HourUTC`, `request:SourceIp`) are populated by the
engine; everything else is host-declared and host-populated — a key with no honest value stays
unpopulated (fails closed).

## Storage

`backends/pg` is a reference implementation on Kysely + Postgres, and it is the only one shipped.
Every storage touchpoint is a port (`GrantStore`, `AuditSink`), so Prisma, Drizzle or another engine
is an implementation away — but you write it. The conformance suite is how you prove it correct.

## Conformance

`src/conformance/cases/*.json` is the backend contract: language-neutral golden fixtures for
deny-wins, scope inheritance, resource matching, condition semantics, asymmetric fail-closed,
malformed-input, and role synthesis. Any alternative backend must decide every case identically —
see `tests/pg.test.ts` for the storage-backed runner template. Cases marked `"storable": false`
carry condition shapes the pg CHECK constraint refuses at rest; a shape-checking backend asserts the
rejection instead.

## Development

```sh
bun install
bun run build           # tsc emit to dist/ + conformance fixtures
bun test                # pg suite needs DATABASE_URL (scratch db is created/dropped), e.g.:
                        #   docker run -d --name authz-pg -e POSTGRES_PASSWORD=x -p 5436:5432 postgres:18-alpine
                        #   echo 'DATABASE_URL=postgres://postgres:x@127.0.0.1:5436/postgres' > .env.test
bunx tsc --noEmit       # TypeScript 7 native typecheck
dprint fmt
```

## Installing from git

The registry is the normal path. Installing straight from the repository also works — `dist/` is
committed, so it resolves without a build step:

```sh
bun add github:developerinlondon/neutron-authz#v0.3.2
```

Regenerate it with `bun run build` after any change to `src/`.

## Releasing

Bump `version` in `package.json`, merge, then push a matching tag:

```sh
git tag v0.3.2 && git push origin v0.3.2
```

The release workflow builds, typechecks and runs the whole suite — including the storage-backed
conformance runner against a Postgres service — then publishes. It refuses a tag whose version
disagrees with `package.json`, so a mistagged release cannot silently republish the previous one.

Publishing uses npm trusted publishing: GitHub exchanges an OIDC token for a short-lived credential,
so no npm token exists in the repository, in CI, or on a developer's machine.

## License

Apache-2.0
