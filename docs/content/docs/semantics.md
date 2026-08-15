---
title: Semantics
weight: 4
icon: book-open
---

The contract, in five rules. Everything else in the library is machinery to enforce these.

## 1. Statements

A statement is `{effect, actions, resources, conditions?}`:

- **actions** come from a closed, host-declared registry — never wildcarded
- **resources** are opaque strings, matched exactly or with a single trailing `*` (prefix)
- **conditions** are typed `{operator, key, value}` triples — no expression language

## 2. Grants and scope chains

A grant is _(policy, subject `{kind,id}`, scope `{kind,id}`)_. A check evaluates against an ordered,
**host-resolved** scope chain, root first:

<img src="/agentauthz/images/fig-scope-chain.svg" style="max-width:100%" alt="Scope chain: a root grant is inherited everywhere, a project grant only in its subtree, a leaf grant exactly at its leaf" />

Every grant at any chain scope applies. Inheritance can only ever **add** statements to consider — a
leaf grant never leaks upward or into a sibling, because a sibling's chain never contains that leaf.
The engine never resolves parentage itself; the host resolves the chain, and a malformed or
undeclared entry **denies** rather than silently evaluating a different chain than the caller named.

A flat model is supported: leave `scopeKinds` unset and pass a single root scope as
`defaultScopeChain`.

## 3. Deny wins

Across the whole resolved chain: an explicit deny beats any allow; nothing granted ⇒ deny.

## 4. Conditions are asymmetric and fail closed

Condition evaluation is tri-state: `match`, `no-match`, or `unmatchable` (malformed, unknown
key/operator, type mismatch, or a key the request context doesn't populate).

|                     | on `match`  | on `unmatchable`        | on `no-match`       |
| ------------------- | ----------- | ----------------------- | ------------------- |
| **allow** statement | contributes | does **not** contribute | does not contribute |
| **deny** statement  | fires       | **fires**               | steps aside         |

An unevaluable condition can never widen access: it silences an allow, and it keeps a deny standing.
Only a definitive `no-match` lifts a conditioned deny — that is the author deliberately scoping it.

## 5. Action derivation

A host may declare that one action derives from another. A statement naming the parent covers
everything deriving from it, transitively — allow **and** deny alike.

```ts
actionRegistryFromCatalogue([
  { action: "edit" },
  { action: "docs.update", derivesFrom: "edit" },
  { action: "docs.delete", derivesFrom: "docs.update" },
]);
// a statement naming "edit" covers all three
```

Three properties make this safe where a wildcard is not:

- **Closed and enumerable.** A wildcard matches unknown future actions; a derivation expands to a
  declared set, and `descendantsOf` lists exactly what a statement permits.
- **Deny expands exactly as allow does.** Otherwise deny would be narrower than allow and the
  engine's posture would invert.
- **Registry data, not policy data.** Authors cannot invent it; the catalogue rejects cycles,
  self-derivation and unknown parents at build time.

Derivation never runs downward or sideways: granting `docs.delete` does not grant `edit`. Actions
are single-parent — deny expands too, so multiple parents would let a deny on any ancestor silently
kill a leaf.

{{< callout type="warning" >}} **Untrusted policy authors are the design center.** Statements may be
drafted by agents. That is why there is no expression language, no action wildcard, why validation
names its errors, and why every malformed input — scope chain, subject, condition shape — resolves
to _less_ access, never more. {{< /callout >}}
