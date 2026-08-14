---
title: Admin surface
weight: 6
---

Every admin screen — a grants table, a policy browser, an audit view, a bounds form — is a pure
function of declarations the engine already holds. So instead of shipping a UI, the library serves
the **vocabulary as data** and a stable HTTP contract over it. Any UI, in any framework, on any
runtime, renders from that.

## `describe()` — the descriptor

```ts
const descriptor = authz.describe();
// or standalone, without an engine:
import { describeAuthz } from "@neutroncore/authz/core";
const descriptor = describeAuthz({ actionRegistry, conditionKeys, scopeKinds });
```

```jsonc
{
  "version": 1,
  "actions": [
    { "action": "docs.read", "title": "Read documents" },
    { "action": "docs.write", "derivesFrom": "docs.read" },
  ],
  "actionClosures": { // descendantsOf, precomputed — a UI shows what
    "docs.read": ["docs.write"], // a grant REALLY confers without walking the graph
    "docs.write": [],
  },
  "conditionKeys": {
    "app:Region": {
      "type": "string",
      "operators": [
        "StringEquals",
        "StringNotEquals",
        "StringLike",
        "StringIn",
        "StringNotIn",
        "StringLikeIn",
      ],
    },
    "request:SourceIp": {
      "type": "ip",
      "builtIn": true,
      "operators": ["IpAddress", "NotIpAddress"],
    },
  },
  "scopeKinds": ["root", "project"],
  "setOperators": ["StringIn", "StringNotIn", "StringLikeIn"],
}
```

Design notes worth knowing:

- **`operators` per key is derived, never authored** — from the key's declared type. A UI that
  duplicated that table client-side would drift from it.
- **`setOperators`** tells a UI which operators take `values` rather than `value`.
- **`builtIn: true`** marks engine-populated `request:*` keys — a UI must not offer them as
  authorable bounds, and must not let an author think a host key will populate itself.
- **`version`** lets a UI refuse a document it does not understand rather than render a half-correct
  form. It bumps only when an old consumer would render a _wrong_ form — never for an additive
  field.
- `title`/`description` on actions and condition keys are optional human labels, straight from the
  registry's annotations.

## The handlers

Plain `(Request) => Promise<Response>` over Web-standard types — the same functions run under Bun,
Node, Deno and Workers with no framework adapter:

```ts
import { createAdminHandler } from "@neutroncore/authz/admin";

const handler = createAdminHandler({
  descriptor: authz.describe(),
  store, // PgAuthzStore satisfies AdminStore as-is
  basePath: "/api/v1/authz",
  actor: (req) => resolveAdmin(req), // recorded as creator + audit subject
  auditSink: store, // admin writes land in the same audit trail
  subjects: { list: (q) => findSubjects(q) }, // optional; absent ⇒ /subjects is 501
});
```

| Route                | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `GET /descriptor`    | the document above                                           |
| `GET /grants`        | list, filterable by subject, scope, policy                   |
| `POST /grants`       | create — validates bounds through `validateConditions` first |
| `DELETE /grants/:id` | revoke                                                       |
| `GET /policies`      | the named policies a grant can reference                     |
| `GET /subjects`      | via the host's subject lister                                |
| `GET /audit`         | the decision trail, filterable, keyset-paginated             |

A rejected write returns the engine's **own** validation message verbatim
(`condition 0: unknown key "app:Nope"`), so a UI surfaces exactly what the evaluator would have said
— the two cannot disagree about what is legal.

{{< callout type="error" >}} **The handlers never decide who may administer.** That is the host's,
by design. Mounting them without authentication in front exposes grant creation to anyone who can
reach the path. {{< /callout >}}

## Mounting under Bun

```ts
Bun.serve({
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/v1/authz")) {
      if (!isAdmin(req)) return new Response("forbidden", { status: 403 });
      return handler(req);
    }
    return app(req);
  },
});
```

The same handler mounts under Node's `http` (via a Request/Response adapter), Deno, or a Cloudflare
Worker unchanged. A host on a runtime that cannot import JavaScript at all can still implement the
same routes over its own storage and be administered by the same UI — the descriptor document _is_
the contract.
