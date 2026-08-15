# @neutroncore/authz

Embeddable TypeScript authorization engine: policy statements + grants-at-scope + typed ABAC
conditions, deny-wins, asymmetric fail-closed. **Policies are rows in your own database** — Postgres backend included, any conformant store
drops in — authored
at runtime — by an admin UI, or by an agent — not files compiled into a deployment.

**Documentation: <https://developerinlondon.github.io/neutron-authz/>**

```sh
npm install @neutroncore/authz        # or: bun add / pnpm add / yarn add
npm install @neutroncore/authz kysely # kysely only for the shipped Postgres backend
```

Compiled ESM with type declarations — plain Node ≥ 20, no bundler. Zero runtime dependencies.

## Sixty seconds

```ts
import { PgAuthzStore } from "@neutroncore/authz/backends/pg";
import { makeAuthz } from "@neutroncore/authz/core";
import { actionRegistryFromCatalogue } from "@neutroncore/authz/ports";

const store = new PgAuthzStore(db, {
  scopeKinds: ["root", "project"],
  rootScope: { kind: "root", id: "*" },
});

const authz = makeAuthz({
  grantStore: store,
  auditSink: store,
  actionRegistry: actionRegistryFromCatalogue([
    { action: "docs.read" },
    { action: "docs.write", derivesFrom: "docs.read" }, // naming docs.read covers both — allow AND deny
  ]),
  conditionKeys: { "app:Region": { type: "string" } },
  defaultScopeChain: [{ kind: "root", id: "*" }],
});

await authz.check([{ kind: "user", id: "alice" }], "docs.write", "doc:42");
// deny-wins over every grant in the scope chain; audited; nothing granted ⇒ false
```

## The admin surface is data, and the UI writes itself

The engine serves its whole vocabulary as a stable JSON document (`describe()`), plus framework-free
`(Request) => Response` admin routes over it. Every screen below is generated from that document —
declare a new condition key server-side and a new form field appears with **no frontend change**:

[![the example admin UI: grants with bounds, a generated bounds form, the coverage panel, a live check, the audit trail](https://developerinlondon.github.io/neutron-authz/images/example-ui.png)](cookbook/)

That page is [`cookbook/ui.html`](cookbook/) — one static file, no framework, no host knowledge. Run
it: `cd cookbook && bun install && bun run server.ts`.

## Architecture

<img src="https://developerinlondon.github.io/neutron-authz/images/architecture.svg" alt="Architecture: your app calls check() and the admin handlers; both cross the ports seam; Postgres is the plugged-in reference backend and any conformant backend drops into the open socket" />

The engine is a pure core behind ports. The shipped Postgres backend is the reference implementation
— **any storage that passes the
[conformance fixtures](https://developerinlondon.github.io/neutron-authz/docs/storage-and-conformance/)
is decision-identical and drops in behind the same seam**, with zero call-site churn. The host keeps
authentication, subject resolution, HTTP routing, the vocabulary, and what the admin UI looks like.

## How it compares

Authorization-when-policies-are-data has five parts: deciding, storing, validating, auditing,
and administering. This library ships all five, in your process. The usual alternatives ship
one.

|                                                | @neutroncore/authz                                                           | Cedar                      | OpenFGA / SpiceDB / Keto        | Casbin                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------- | ------------------------------- | ------------------------- |
| Decide + store + validate + audit + administer | **all five, out of the box**                                                 | evaluator only             | check service; the rest varies  | evaluator + thin adapters |
| Extra infrastructure                           | **none** — in-process                                                        | none (WASM from JS)        | a stateful service to run       | none                      |
| Runtime authoring by admins & agents           | **first-class** — schema-validated rows, named errors a UI shows verbatim    | build it yourself          | tuples via API                  | reload from adapters      |
| Storage                                        | **shipped and swappable** — conformance fixtures prove a replacement backend | bring your own             | the service's own               | thin adapters             |
| A deny whose condition can't evaluate          | **the deny stands** — fail closed                                            | erroring policy is skipped | n/a (graph model)               | depends on the matcher    |
| Safe for untrusted/agent policy authors        | **by construction** — no expression language, closed vocabulary              | expression language        | n/a                             | evaluated matcher strings |
| Per-decision audit                             | **built in**                                                                 | build it yourself          | varies                          | build it yourself         |
| Admin surface                                  | **served as data** — descriptor + handlers, one UI fits any host             | build it yourself          | service APIs                    | build it yourself         |

Different products solve different problems: Cedar is a formally verified evaluator for
policies engineers review in git — there, CI is the admin surface and the missing ring doesn't
hurt. Zanzibar services (OpenFGA, SpiceDB, Ory Keto) answer graph questions ("list everything alice can see") over millions
of relationships — a reverse-index query shape this library deliberately doesn't do. For the
question *may this subject do this action on this resource, right now* — with the policies
themselves written and administered at runtime — this is the complete package.
[Full comparison →](https://developerinlondon.github.io/neutron-authz/docs/comparison/)

## Concepts in one line each

| Concept           | In short                                                                                       | Docs                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Statements        | `{effect, actions, resources, conditions?}` — actions from a closed registry, never wildcarded | [Semantics](https://developerinlondon.github.io/neutron-authz/docs/semantics/)                           |
| Scope chains      | host-resolved, root-first; deny anywhere beats allow anywhere; malformed ⇒ deny                | [Semantics](https://developerinlondon.github.io/neutron-authz/docs/semantics/)                           |
| Conditions        | typed operator whitelist, tri-state, asymmetric fail-closed — no expression language           | [Conditions](https://developerinlondon.github.io/neutron-authz/docs/conditions/)                         |
| Action derivation | a statement naming a parent covers its declared, enumerable family — allow and deny alike      | [Semantics](https://developerinlondon.github.io/neutron-authz/docs/semantics/)                           |
| Grant bounds      | conditions on the grant: one curated policy, different limits per subject; narrows allow only  | [Grants & bounds](https://developerinlondon.github.io/neutron-authz/docs/grants-and-bounds/)             |
| Role synthesis    | app-owned role rows become grants at check time — one storage, no dual-write                   | [Architecture](https://developerinlondon.github.io/neutron-authz/docs/architecture/)                     |
| Descriptor        | the vocabulary as versioned JSON; any UI on any runtime renders from it                        | [Admin surface](https://developerinlondon.github.io/neutron-authz/docs/admin-surface/)                   |
| Conformance       | golden fixtures any alternative backend must decide identically — the swap-proof               | [Storage & conformance](https://developerinlondon.github.io/neutron-authz/docs/storage-and-conformance/) |

## Development

```sh
bun install
bun test                # pg suite needs DATABASE_URL (scratch db created/dropped)
bunx tsc --noEmit
```

Installing straight from git also works (`bun add github:developerinlondon/neutron-authz#v0.4.2`) —
`dist/` is committed and CI refuses a stale one.

## Releasing

Bump `version` in `package.json`, merge, push the matching tag
(`git tag v0.4.2 && git push origin v0.4.2`). The release workflow typechecks, runs the whole suite
including the storage-backed conformance runner against Postgres, refuses a tag that disagrees with
`package.json`, and publishes via npm trusted publishing — no token exists anywhere.

## License

Apache-2.0
