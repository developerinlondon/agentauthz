---
title: MCP server
weight: 9
icon: chip
---

An agent that can be granted a capability needs a way to be granted one. `agentauthz/mcp` serves
this host's authorization over the [Model Context Protocol](https://modelcontextprotocol.io) —
tools a model calls to check a permission, grant a bounded one, revoke it, and read the trail it
left.

It is a thin adapter over the same ports the [admin surface](../admin-surface/) uses, with one
property that matters more than the transport:

**The tool input schemas are generated from the descriptor.** Declare a condition key server-side
and the `authz_grant` tool's input schema grows a typed field for it — the same generative property
the [descriptor-driven UI](../building-a-ui/) has, extended to the consumer that reads schemas
instead of forms. Nothing in this package enumerates your vocabulary.

## Wiring one up

```ts
import { createMcpServer } from "agentauthz/mcp";

const server = createMcpServer({
  authz, // the engine itself: answers checks, and supplies the vocabulary
  store, // PgAuthzStore satisfies AdminStore as-is
  actor: { kind: "user", id: "admin@example.com" }, // recorded as creator + audit subject
  auditSink: store, // grant/revoke land in the same audit trail
});

await server.runStdio(); // newline-delimited JSON-RPC on stdin/stdout
```

| Option       | Purpose                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| `authz`      | the engine — checks are decided by it, and `authz.describe()` builds the schemas    |
| `store`      | `AdminStore`: grants, policies, audit                                              |
| `descriptor` | overrides `authz.describe()` — serve agents a _narrower_ vocabulary than you decide by |
| `actor`      | who is performing the write, for this connection                                   |
| `subjects`   | optional subject lister                                                            |
| `auditSink`  | where administrative writes are recorded                                           |

An MCP session carries no per-request identity, so `actor` is fixed for the connection: a host
serving several administrators builds one server per session.

For an embedding that already owns its transport — an HTTP endpoint, a worker, a test —
`handleMessage(message)` takes one parsed JSON-RPC message and returns the response, or `null` for
a notification. `runStdio` is that function plus line framing.

## The tools

| Tool                | Does                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `authz_check`       | may these subjects do this, here, under this context?            |
| `authz_grant`       | attach a policy to a subject at a scope, optionally bounded      |
| `authz_revoke`      | delete one grant by id                                           |
| `authz_grants`      | list grants with their ids — what `authz_revoke` names           |
| `authz_policies`    | the named policies a grant can reference                         |
| `authz_audit_query` | the decision and administration trail                            |
| `authz_describe`    | the vocabulary as data — what the schemas above were built from  |

Grants and revocations are audited exactly as the HTTP handlers audit them, with `source`
`authz-mcp` rather than `authz-admin`, so an agent's grant is distinguishable from an operator's
without reading anything else. Checks are audited by the engine, as every check is.

## Generated schemas

For a host declaring `app:Region` (string), `app:MaxCost` (number) and scope kinds `root`/`space`,
`tools/list` reports an `authz_grant` whose `bounds` accepts exactly the legal shapes:

```jsonc
{
  "bounds": {
    "type": "array",
    "items": {
      "anyOf": [
        {
          "title": "app:Region",
          "properties": {
            "key": { "const": "app:Region" },
            "operator": { "enum": ["StringEquals", "StringNotEquals", "StringLike"] },
            "value": { "type": "string", "minLength": 1 },
          },
        },
        {
          "title": "app:Region (set membership)", // takes `values`, not `value`
          "properties": {
            "key": { "const": "app:Region" },
            "operator": { "enum": ["StringIn", "StringNotIn", "StringLikeIn"] },
            "values": { "type": "array", "minItems": 1 },
          },
        },
        {
          "title": "app:MaxCost", // a number key never admits a set operator
          "properties": {
            "key": { "const": "app:MaxCost" },
            "operator": { "enum": ["NumericLessThan", "NumericGreaterThan"] },
            "value": { "type": ["string", "number"] },
          },
        },
      ],
    },
  },
}
```

Everything above is derived from declarations:

- **operators per key** come from the key's declared type, so a model cannot assemble
  `NumericLessThan` on a string key from the schema at all.
- **set operators are their own branch**, because they take `values` and the scalar operators take
  `value` — a condition carrying both is unreadable, and the schema never offers it.
- **`authz_check`'s `context`** is one typed property per host key: a string key accepts a string
  _or_ an array of strings (a principal holding several roles at once), a number key a number, a
  date key an RFC 3339 string.
- **built-in `request:*` keys are bindable as bounds but absent from `context`** — the engine
  populates them from the real check inputs, so offering them would invite a value that is silently
  discarded. `sourceIp` is a first-class field instead.
- **`scope.kind` and `authz_check`'s `action`** are enums when the host declares them, and open
  strings when it declares none.
- **declared `lowercase`** reaches the model as part of the key's description, rather than
  surprising it at compare time.

## Rejections are the engine's own words

A bound the engine will not store comes back as an MCP tool error whose text is the evaluator's
message, unmodified:

```jsonc
{
  "isError": true,
  "content": [{ "type": "text", "text": "condition 0: unknown key \"app:Nope\"" }],
}
```

That is the whole point of [named validation errors](../conditions/): the consumer is a program,
and a program that is told _which condition_ and _why_ can correct itself and retry without a human
translating. Store rejections pass through the same way.

## Protocol

JSON-RPC 2.0 over newline-delimited JSON — `initialize`, `notifications/initialized`, `ping`,
`tools/list`, `tools/call`. The advertised revision is `2025-06-18`; a client asking for
`2025-03-26` or `2024-11-05` is answered in its own, as the tools surface is identical across the
three. Capabilities are `tools` only: this server exposes no resources, prompts, or sampling.

It is implemented here rather than on the MCP SDK, because this package has
[zero runtime dependencies](../architecture/) and an authorization engine acquiring its first one
to speak a framing protocol is a poor trade.

{{< callout type="error" >}} **The MCP server never decides who may administer.** That is the
host's, by design — exactly as with the HTTP handlers. Anything that can reach the transport can
call `authz_grant`, so gate the transport: a stdio server inherits the trust of the process that
spawned it, and an HTTP-mounted one needs the same authentication as the admin routes.
{{< /callout >}}

{{< callout type="warning" >}} **A narrowed `descriptor` withholds options; it does not withhold
authority.** The engine still decides by its own vocabulary. Passing a narrower descriptor shapes
what the tools offer — it is not an access control, and never a substitute for one.
{{< /callout >}}
