# Example host

A complete host in two files, in memory, nothing to configure:

```sh
bun install
bun run server.ts     # → http://localhost:8787
```

| File        | What it shows                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server.ts` | a vocabulary, an in-memory `AdminStore`/`GrantStore`/`AuditSink` (~100 lines — the whole port surface), the engine, the admin handlers, a `/api/check` probe |
| `ui.html`   | a complete admin UI in one static file, generated entirely from `GET /descriptor` — no host names anywhere in the script                                     |

Things to try in the browser:

- grant **article-author** to `alice` with a bound `app:Region StringEquals eu-west`, then run the
  check probe with and without the region — the bound withdraws the allow
- check `alice` against `billing.read` — the policy's own deny stands regardless of bounds
- check `articles.publish` — covered via derivation from `articles.write`; the coverage panel showed
  you that before you saved
- submit a bound with the wrong operator — the error text is the engine's own, verbatim
- add a condition key to `conditionKeys` in `server.ts`, restart — a new form field appears with
  **no change to `ui.html`** (that is the reuse test the descriptor exists to pass)

The full walk-through lives in the docs:
<https://developerinlondon.github.io/neutron-authz/docs/building-a-ui/>
