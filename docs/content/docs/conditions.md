---
title: Conditions
weight: 4
---

Conditions are typed triples, never expressions. Scalar operators read `value`; set operators read
`values`. Exactly one is populated — a condition carrying both is unmatchable rather than a guess at
which the author meant.

## The operator whitelist

| Operator                                 | Bound    | Key type | Notes                                           |
| ---------------------------------------- | -------- | -------- | ----------------------------------------------- |
| `StringEquals` / `StringNotEquals`       | `value`  | string   | array context ⇒ set-wise                        |
| `StringLike`                             | `value`  | string   | **exact, or one trailing `*`** — not a glob     |
| `StringIn` / `StringNotIn`               | `values` | string   | membership; `StringNotIn` is the exact negation |
| `StringLikeIn`                           | `values` | string   | membership across trailing-`*` prefixes         |
| `NumericLessThan` / `NumericGreaterThan` | `value`  | number   | **the bound is a string**: `"5"`                |
| `DateLessThan` / `DateGreaterThan`       | `value`  | date     | value must carry `Z` or an explicit offset      |
| `IpAddress` / `NotIpAddress`             | `value`  | ip       | CIDR membership, IPv4 and IPv6                  |

Each condition key declares the type its context value carries, and that type fixes which operator
family may test it. `validateStatements` enforces this at save time; the evaluator re-checks it at
decision time.

## Declaring keys

```ts
conditionKeys: {
  "app:Region":  { type: "string" },
  "app:Email":   { type: "string", lowercase: true },  // compared case-insensitively, both sides
  "app:MaxCpu":  { type: "number" },
  "app:Network": { type: "ip" },
}
```

Three keys are built in and populated by the engine itself on every check:

| Key                | Type   | Populated from                                                      |
| ------------------ | ------ | ------------------------------------------------------------------- |
| `request:Time`     | date   | the evaluation instant (UTC ISO-8601)                               |
| `request:HourUTC`  | number | hour of day, 0–23                                                   |
| `request:SourceIp` | ip     | the check's `sourceIp` option — absent ⇒ unpopulated ⇒ fails closed |

A key with no honest value stays **unpopulated**, never faked. A condition on an unpopulated key is
unmatchable — the allow never fires, the deny stands.

## Set membership

An allowlist is one condition, not one statement per permitted value:

```ts
conditions: [
  { operator: "StringIn", key: "app:Pool", values: ["infra", "lite"] },
];
```

With a list on both sides — policy `values` and a multi-valued context key — the semantic is a
**non-empty intersection**. `StringNotIn` is its exact negation, true only when nothing intersects.
An empty `values` list is rejected at write time and unmatchable at evaluation, so it can never read
as a vacuous allow.

## The two traps

Both read as working policies and are not, so both are rejected on the write path:

{{< callout type="error" >}}
**`StringLike` is prefix-only.** `"infra|lite"` is a literal string that matches nothing —
it is not a regex, not a glob. Use `StringIn` with a values list.
{{< /callout >}}

{{< callout type="error" >}}
**A numeric bound is a string.** `value: 5` is a type error that would evaluate as an
unmatchable condition rather than a loud failure. Write `value: "5"`.
{{< /callout >}}
