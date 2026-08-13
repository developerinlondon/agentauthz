// Ten semantic tokens, each with a fallback that already looks coherent, and
// --authz-font defaulting to inherit so typography matches the host before
// anything is configured. No hard-coded palette: a host restyles the whole
// component by setting these on any ancestor.
export const AUTHZ_STYLES = `
.authz-admin {
  --authz-font: inherit;
  --authz-fg: #1c1e21;
  --authz-fg-muted: #6b7280;
  --authz-bg: #ffffff;
  --authz-bg-subtle: #f6f7f9;
  --authz-border: #d9dce1;
  --authz-accent: #2f6feb;
  --authz-accent-fg: #ffffff;
  --authz-danger: #b42318;
  --authz-radius: 6px;

  font-family: var(--authz-font);
  color: var(--authz-fg);
  background: var(--authz-bg);
}
.authz-admin *, .authz-admin *::before, .authz-admin *::after { box-sizing: border-box; }
.authz-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--authz-border); }
.authz-tab {
  padding: 8px 14px; border: 0; background: none; cursor: pointer;
  font: inherit; color: var(--authz-fg-muted); border-bottom: 2px solid transparent;
}
.authz-tab[aria-selected="true"] { color: var(--authz-fg); border-bottom-color: var(--authz-accent); }
.authz-panel { padding: 16px 0; }
.authz-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.authz-table th, .authz-table td {
  text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--authz-border);
  vertical-align: top;
}
.authz-table th { color: var(--authz-fg-muted); font-weight: 500; }
.authz-chip {
  display: inline-block; padding: 2px 8px; margin: 0 4px 4px 0;
  border-radius: var(--authz-radius); background: var(--authz-bg-subtle);
  border: 1px solid var(--authz-border); font-size: 12px;
}
.authz-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.authz-field label { font-size: 13px; color: var(--authz-fg-muted); }
.authz-input, .authz-select {
  font: inherit; padding: 6px 8px; color: var(--authz-fg); background: var(--authz-bg);
  border: 1px solid var(--authz-border); border-radius: var(--authz-radius);
}
.authz-row { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
.authz-button {
  font: inherit; padding: 7px 14px; cursor: pointer; border-radius: var(--authz-radius);
  border: 1px solid var(--authz-accent); background: var(--authz-accent);
  color: var(--authz-accent-fg);
}
.authz-button[data-variant="ghost"] {
  background: none; color: var(--authz-fg); border-color: var(--authz-border);
}
.authz-button[data-variant="danger"] {
  background: none; color: var(--authz-danger); border-color: var(--authz-border);
}
.authz-button:disabled { opacity: 0.55; cursor: not-allowed; }
.authz-coverage {
  border: 1px solid var(--authz-border); border-radius: var(--authz-radius);
  padding: 12px; background: var(--authz-bg-subtle);
}
.authz-error {
  color: var(--authz-danger); border: 1px solid var(--authz-danger);
  border-radius: var(--authz-radius); padding: 10px 12px; margin-bottom: 12px;
  background: var(--authz-bg);
}
.authz-muted { color: var(--authz-fg-muted); font-size: 13px; }
`;
//# sourceMappingURL=styles.js.map