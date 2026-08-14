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
  Policy statements, grants-at-scope, typed ABAC conditions.&nbsp;<br class="hx:sm:block hx:hidden" />Deny wins. Everything fails closed. No extra service.
{{< /hextra/hero-subtitle >}}
</div>

<div class="hx:mb-6">
{{< hextra/hero-button text="Get started" link="docs/getting-started" >}}
</div>

{{< hextra/feature-grid >}}
  {{< hextra/feature-card title="Policies are rows, not files" subtitle="Authored at runtime — by an admin UI or an agent — validated on write, audited on every decision. Storage ships with the engine." >}}
  {{< hextra/feature-card title="Fail-closed, asymmetrically" subtitle="An allow needs a definitive match. A deny stands even when its condition cannot be evaluated. Both directions fail toward less access." >}}
  {{< hextra/feature-card title="An admin surface, served as data" subtitle="describe() projects your vocabulary into a stable JSON document; framework-free handlers serve it. One descriptor drives any UI." >}}
{{< /hextra/feature-grid >}}
