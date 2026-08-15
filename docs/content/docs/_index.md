---
title: Documentation
cascade:
  type: docs
---

`@neutroncore/authz` is an embeddable TypeScript authorization engine. Policies are **rows in your
own database**, written at runtime through an API or an admin UI, not files compiled into a
deployment.

## Where to start

{{< cards >}}
  {{< card link="getting-started" title="Getting started" subtitle="Install, declare a vocabulary, make your first check" >}}
  {{< card link="architecture" title="Architecture" subtitle="The layers, the ports, and why the engine owns storage" >}}
  {{< card link="comparison" title="Comparison" subtitle="What ships complete here vs Cedar, Zanzibar services, Casbin" >}}
  {{< card link="semantics" title="Semantics" subtitle="Statements, deny-wins, scope chains, fail-closed conditions" >}}
  {{< card link="conditions" title="Conditions" subtitle="The typed operator whitelist and its two traps" >}}
  {{< card link="grants-and-bounds" title="Grants & bounds" subtitle="One curated policy, different limits per subject" >}}
  {{< card link="admin-surface" title="Admin surface" subtitle="describe(), the descriptor document, and the HTTP handlers" >}}
  {{< card link="building-a-ui" title="Building a UI" subtitle="Generate every admin screen from the descriptor" >}}
  {{< card link="cookbook" title="Cookbook" subtitle="A runnable host with a working admin UI, recipe by recipe" >}}
  {{< card link="storage-and-conformance" title="Storage & conformance" subtitle="The pg backend, migrations, and the backend-flip contract" >}}
{{< /cards >}}

## The shape of it

```mermaid
flowchart LR
    subgraph host["Your application"]
        R[HTTP routes] --> A
        UI[Your admin UI] --> H
    end
    subgraph lib["@neutroncore/authz"]
        A["Authz.check()"] --> E[pure evaluator]
        H["admin handlers"] --> D["describe()"]
        E --> P[(GrantStore port)]
        H --> P
    end
    P --> PG[("authz_* tables<br/>in YOUR Postgres")]
```

The host keeps, permanently: authentication and subject resolution, the admin-bypass decision,
HTTP routing, the action vocabulary, and what the admin UI looks like. The library owns the
decision semantics, validation, storage, and audit.
