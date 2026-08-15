---
title: Getting started
weight: 1
icon: play
---

## Install

```sh
npm install @neutroncore/authz        # or: bun add / pnpm add / yarn add
npm install @neutroncore/authz kysely # kysely only if you use the Postgres backend
```

Compiled ESM with type declarations — plain Node ≥ 20 consumes it, no bundler required.

## Declare a vocabulary

The engine accepts **only** actions you declare. There is no action wildcard.

```ts
import { actionRegistryFromCatalogue } from "@neutroncore/authz/ports";

const actions = actionRegistryFromCatalogue([
  { action: "docs.read", title: "Read documents" },
  { action: "docs.list", derivesFrom: "docs.read" },
  { action: "docs.write", derivesFrom: "docs.read", title: "Write documents" },
]);
```

A statement naming `docs.read` covers `docs.list` and `docs.write` too — allow _and_ deny alike.
Derivation is registry data: a policy author cannot invent it.

## Wire the engine

```ts
import { PgAuthzStore } from "@neutroncore/authz/backends/pg";
import { makeAuthz } from "@neutroncore/authz/core";

const store = new PgAuthzStore(db, {
  scopeKinds: ["root", "project"],
  rootScope: { kind: "root", id: "*" },
});

const authz = makeAuthz({
  grantStore: store,
  auditSink: store,
  actionRegistry: actions,
  scopeKinds: ["root", "project"],
  defaultScopeChain: [{ kind: "root", id: "*" }],
  conditionKeys: {
    "app:Region": { type: "string" },
  },
});
```

`db` is your own Kysely instance — the `authz_*` tables live in **your** database. See
[Storage & conformance](../storage-and-conformance) for the migrations.

## Create a policy and grant it

```ts
const policy = await store.createPolicy({
  name: "doc-reader",
  description: "Read access to all documents",
  statements: [
    { effect: "allow", actions: ["docs.read"], resources: ["doc:*"] },
  ],
  createdBy: null,
});

await store.createGrant({
  policyId: policy.id,
  subject: { kind: "user", id: "alice" },
  scope: { kind: "root", id: "*" },
  createdBy: null,
});
```

## Check

```ts
await authz.check(
  [{ kind: "user", id: "alice" }], // the caller's resolved subjects
  "docs.list", // covered via derivation from docs.read
  "doc:42",
);
// => true — and an audit row was written
```

Every check is audited from inside the seam. Nothing granted ⇒ `false`; a deny anywhere in the scope
chain beats an allow from anywhere else.

{{< callout type="info" >}} Identity is **your** job: resolve the caller into explicit `{kind, id}`
subjects before they reach the engine — including any normalization such as lowercasing emails. The
library stores no principals; a dangling reference simply never matches. {{< /callout >}}
