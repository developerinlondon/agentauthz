---
title: Architecture
weight: 2
---

## Why the engine owns storage

Most authorization libraries are evaluators: you hand them policies, they return a decision, and
storage is your problem. That split is right when policies are written by developers and shipped in
git. It is wrong when policies are **data** — written by admins through a UI, or drafted by an agent
— because then you need a schema, migrations, write-time validation, and an audit trail, and you end
up building all four anyway.

This library ships both halves, in-process, against your own Postgres. No sidecar, no network hop,
no cache-invalidation webhook, no fail-open-when-the-PDP-is-down question.

## How it compares

|  | @neutroncore/authz | Cedar | OpenFGA / SpiceDB | Casbin |
| --- | --- | --- | --- | --- |
| Runs as | in-process library | in-process (WASM from JS) | **separate stateful service** | in-process library |
| Policy shape | typed statements + typed ABAC conditions | Cedar policy language | relationship tuples (+ CEL caveats) | matcher expression strings |
| Runtime authoring by admins/agents | first-class: schema-validated rows, named errors | possible; storage is yours | tuples via API | reload from adapters |
| Storage | **shipped**: Postgres + migrations + at-rest checks; swappable behind a port | bring your own | the service's own | thin adapters |
| A deny whose condition can't evaluate | **deny stands** (fail closed) | erroring policy is skipped | n/a (graph model) | depends on the matcher |
| Per-decision audit | built in | bring your own | varies | bring your own |
| Admin surface | descriptor + handlers served | bring your own | service APIs | bring your own |
| Reverse queries at scale | no — checks only | no | **yes — their home turf** | limited |
| Formally verified evaluator | no | **yes** | no | no |

The two load-bearing rows: when policies are **data written by admins and agents**, an
evaluator-only library leaves you building storage, migrations, validation, audit and the admin
surface yourself — and when a deny's condition cannot be evaluated, this engine keeps the deny
standing, where an engine that skips an erroring policy fails **open** exactly where the author
asked it to fail closed.

Reach for the others where their strengths are real: **Cedar** for the formally verified
evaluator and analysis tooling, building the ring around it yourself; **OpenFGA/SpiceDB** when
your questions are graph-shaped over millions of relationships — reverse indexing at scale is
genuinely their product, and this library does not do it.

## The layers

```mermaid
flowchart TD
    subgraph model["model/ — THE SPEC as types"]
        M[statement · condition · grant · subject · scope · descriptor]
    end
    subgraph core["core/ — pure, zero deps, no I/O"]
        EV[evaluate: deny-wins over applicable grants]
        CO[conditions: tri-state, fail-closed]
        VA[validateStatements: write-time gate]
        DE["describe(): vocabulary → descriptor"]
    end
    subgraph ports["ports/ — the seams"]
        GS[GrantStore]
        AS[AuditSink]
        SY[ScopeRoleSynthesizer]
        AR[ActionRegistry]
        SD[SubjectDirectory]
    end
    subgraph adapters["shipped adapters"]
        PG["backends/pg — reference Kysely store"]
        AD["admin/ — (Request) ⇒ Response routes"]
        CF["conformance/ — golden fixtures + runner"]
    end
    model --> core --> ports
    ports --> PG
    core --> AD
    CF -.->|proves decision-identical| PG
```

| Layer          | Depends on         | Job                                            |
| -------------- | ------------------ | ---------------------------------------------- |
| `model/`       | nothing            | the shapes and their invariants                |
| `core/`        | `model/`           | decide, validate, describe — pure functions    |
| `ports/`       | `model/`           | the interfaces a host or backend plugs into    |
| `backends/pg`  | `ports/` + kysely  | the only shipped storage; the reference        |
| `admin/`       | `core/` + `ports/` | HTTP surface over the store and descriptor     |
| `conformance/` | `core/`            | the contract any alternative backend must pass |

## The enforcement seam

Every "may these subjects do this action on this resource?" question goes through `Authz.check()` —
no call site reads grant storage directly. That is what makes the storage backend swappable with
zero call-site churn: an alternative backend implements `GrantSource`, passes the
[conformance suite](../storage-and-conformance#conformance), and the config flips.

```mermaid
sequenceDiagram
    participant H as Host route
    participant A as Authz.check
    participant S as GrantStore
    participant Y as Synthesizers
    participant E as evaluator
    H->>A: subjects, action, resource, opts
    A->>A: validate scope chain (unknown kind ⇒ deny)
    A->>S: grantsFor(subjects, chain)
    A->>Y: grantsFor(subjects, chain)
    A->>E: decide(stored ∪ synthesized)
    E-->>A: allow / deny (deny wins)
    A->>A: audit the decision
    A-->>H: boolean
```

**Role synthesis** deserves a note: app-owned role rows (a membership table, a device link) become
grants _at check time_ via `ScopeRoleSynthesizer` — one storage, no dual-write. A synthesized grant
is confined exactly like a stored one at the same scope, and `checkDetailed()` reports whether the
stored grants alone would allow (so a host can tell "explicitly granted" from "allowed by an ambient
default").

## Two enforcement points, same rules

`validateStatements` rejects a bad document at **save** time with a named error a UI can show
verbatim. The evaluator re-checks shape fail-closed at **decision** time — so a row written by an
older code path, a migration, or a future bug still cannot widen authority silently. The pg backend
adds a third, shape-only CHECK constraint at rest.
