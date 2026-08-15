---
title: Conditions
weight: 5
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
| `NumericLessThan` / `NumericGreaterThan` | `value`  | number   | authored as `5` or `"5"` — normalized on write  |
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

## The validator refuses what would silently mean nothing

`StringLike` is deliberately not a regex and not SQL — patterns match exactly, or as a prefix
with one trailing `*`. An author reaching for another engine's dialect writes something that
*reads* as a policy and matches nothing, so the write path refuses it and names the fix:

| You write | The validator answers |
| --- | --- |
| `StringLike "infra\|lite"` | `"\|" is not alternation here; use StringIn/StringLikeIn with a values list` |
| `StringLike "infra%"` | `"%" is not a wildcard here; the only wildcard is a single trailing *` |
| `NumericLessThan value: 5` (a JSON number) | accepted — normalized to `"5"` at write time |
| `DateLessThan "2026-08-01T00:00:00"` | `has no timezone — a bare timestamp parses in the SERVER's local time` |
| `IpAddress "10.0.0.7"` | `not a valid IPv4 or IPv6 CIDR (e.g. 10.0.0.0/8)` |

Every message is produced by `validateConditions` and returned verbatim through the admin
routes, so a UI shows the author exactly what the engine will and won't do — a dead-on-arrival
policy cannot be saved through any supported path. And should a malformed row reach storage
some other way, evaluation still fails closed: the allow never fires, a deny stands.
