---
title: "@neutroncore/authz"
layout: hextra-home
---

{{< hextra/hero-badge link="https://www.npmjs.com/package/@neutroncore/authz" >}}
  npm install @neutroncore/authz
{{< /hextra/hero-badge >}}

<div class="hx:mt-6 hx:mb-6">
{{< hextra/hero-headline >}}
  Authorization as data,&nbsp;<br class="hx:sm:block hx:hidden" />in your own Postgres
{{< /hextra/hero-headline >}}
</div>

<div class="hx:mb-12">
{{< hextra/hero-subtitle >}}
  Policy statements · grants at scope · typed ABAC conditions.&nbsp;<br class="hx:sm:block hx:hidden" />Deny wins, everything fails closed, and there is no extra service to run.
{{< /hextra/hero-subtitle >}}
</div>

<div class="hx:mt-4 hx:w-full">
{{< cards >}}
  {{< card link="docs/getting-started" title="Getting started" subtitle="Install, declare a vocabulary, make your first check" >}}
  {{< card link="docs/architecture" title="Architecture" subtitle="The layers, the ports, and why the engine owns storage" >}}
  {{< card link="docs/comparison" title="Comparison" subtitle="What ships complete here vs Cedar, Zanzibar services, Casbin" >}}
  {{< card link="docs/semantics" title="Semantics" subtitle="Statements, deny-wins, scope chains, fail-closed conditions" >}}
  {{< card link="docs/conditions" title="Conditions" subtitle="The typed operator whitelist, and what the validator refuses" >}}
  {{< card link="docs/grants-and-bounds" title="Grants & bounds" subtitle="One curated policy, different limits per subject" >}}
  {{< card link="docs/admin-surface" title="Admin surface" subtitle="describe(), the descriptor document, and the HTTP handlers" >}}
  {{< card link="docs/building-a-ui" title="Building a UI" subtitle="Generate every admin screen from the descriptor" >}}
  {{< card link="docs/cookbook" title="Cookbook" subtitle="A runnable host with a working admin UI, recipe by recipe" >}}
  {{< card link="docs/storage-and-conformance" title="Storage & conformance" subtitle="The pg backend, migrations, and the backend-flip contract" >}}
{{< /cards >}}
</div>
