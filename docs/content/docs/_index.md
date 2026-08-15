---
title: Documentation
cascade:
  type: docs
---

`agentauthz` is an agent-native, embeddable TypeScript authorization engine. Policies are **rows in your
own database**, written at runtime through an API or an admin UI, not files compiled into a
deployment.

## Where to start

{{< cards >}}
  {{< card link="getting-started" icon="play" title="Getting started" subtitle="Install, declare a vocabulary, make your first check" >}}
  {{< card link="architecture" icon="cube" title="Architecture" subtitle="The layers, the ports, and why the engine owns storage" >}}
  {{< card link="comparison" icon="scale" title="Comparison" subtitle="What ships complete here vs Cedar, Zanzibar services, Casbin" >}}
  {{< card link="semantics" icon="book-open" title="Semantics" subtitle="Statements, deny-wins, scope chains, fail-closed conditions" >}}
  {{< card link="conditions" icon="adjustments" title="Conditions" subtitle="The typed operator whitelist and its two traps" >}}
  {{< card link="grants-and-bounds" icon="key" title="Grants & bounds" subtitle="One curated policy, different limits per subject" >}}
  {{< card link="admin-surface" icon="server" title="Admin surface" subtitle="describe(), the descriptor document, and the HTTP handlers" >}}
  {{< card link="building-a-ui" icon="template" title="Building a UI" subtitle="Generate every admin screen from the descriptor" >}}
  {{< card link="mcp-server" icon="chip" title="MCP server" subtitle="Agent-facing tools whose schemas come from your vocabulary" >}}
  {{< card link="cookbook" icon="beaker" title="Cookbook" subtitle="A runnable host with a working admin UI, recipe by recipe" >}}
  {{< card link="storage-and-conformance" icon="database" title="Storage & conformance" subtitle="The pg backend, migrations, and the backend-flip contract" >}}
{{< /cards >}}

## The shape of it

<img src="/agentauthz/images/architecture.svg" style="max-width:100%" alt="Architecture: your app calls check() and the admin handlers; both cross the ports seam; Postgres is the plugged-in reference backend and any conformant backend drops into the open socket" />

The host keeps, permanently: authentication and subject resolution, the admin-bypass decision,
HTTP routing, the action vocabulary, and what the admin UI looks like. The library owns the
decision semantics, validation, storage, and audit.
