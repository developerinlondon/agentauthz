---
title: Comparison
weight: 10
---

The comparison that matters is not evaluator against evaluator — it is **how much of the
authorization problem is solved when policies are data**, written at runtime by admins and
agents rather than compiled from files. That problem has five parts: deciding, storing,
validating, auditing, and administering. This library ships all five, in your process, against
your own database.

|  | @neutroncore/authz | Cedar | OpenFGA / SpiceDB | Casbin |
| --- | --- | --- | --- | --- |
| Complete out of the box — decide + store + validate + audit + administer | **all five** | evaluator only | check service; the rest varies | evaluator + thin adapters |
| Extra infrastructure to run | **none** — in-process | none (WASM from JS) | a stateful service to deploy, scale and keep up | none |
| Policies authored at runtime by admins and agents | **first-class**: schema-validated rows, errors named so a UI shows them verbatim | build it yourself | tuples via API | reload from files/adapters |
| Storage | **shipped** — Postgres with migrations and at-rest checks — and swappable: any backend passing the conformance fixtures is decision-identical | bring your own | the service's internal store | thin adapters |
| A deny whose condition cannot be evaluated | **the deny stands** — fail closed | the erroring policy is skipped — the deny silently lifts | n/a (graph model) | depends on the matcher |
| Safe for untrusted policy authors | **by construction**: no expression language, closed action vocabulary, no action wildcards | full expression language to review | n/a | matchers are evaluated expression strings |
| Per-decision audit trail | **built in**, fire-and-forget | build it yourself | varies | build it yourself |
| Admin surface | **served as data**: the descriptor + framework-free handlers; one UI fits any host | build it yourself | service APIs | build it yourself |
| Runtime dependencies | **zero** (kysely optional, for the pg backend) | WASM binding | client SDK + server | dependency tree |

The deny row deserves a sentence: an engine that skips an erroring policy fails **open** at the
exact place the author asked it to fail closed. Here, an allow needs a definitive match and a
deny stands on anything less than a definitive miss — both directions resolve toward less
access. That asymmetry is the design center, and it is pinned by
[conformance fixtures](../storage-and-conformance#conformance) any alternative backend must
reproduce.

## Different problems

Two things in that table's neighborhood are different products, not missing features:

- **Formally verified evaluation of a policy language** is Cedar's product. If your policies are
  written by engineers, reviewed in git, and shipped with deployments, Cedar's verification and
  analysis tooling are the point — and storage, audit and administration being your problem is
  fine, because your CI is the admin surface.
- **Graph questions at scale** — "list everything alice can see" over millions of relationships —
  are what Zanzibar-shaped services (OpenFGA, SpiceDB) exist to answer. That is a reverse-index
  query shape, not a check, and it justifies running the extra service when you have it.

This library asks a narrower question — *may this subject do this action on this resource,
right now* — and answers it with everything around the answer already built.
