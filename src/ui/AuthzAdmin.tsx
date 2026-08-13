import { useEffect, useState } from "react";
import type { AdminAuditRecord } from "../admin/types.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { GrantRecord, PolicyRecord } from "../model/grant.js";
import type { FetchLike } from "./client.js";
import { coverageOf } from "./derive.js";
import { GrantEditor } from "./GrantEditor.js";
import { AUTHZ_STYLES } from "./styles.js";
import { useAuthzAdmin } from "./useAuthzAdmin.js";

export interface AuthzAdminProps {
  baseUrl: string;
  fetch?: FetchLike;
  className?: string;
}

type Tab = "grants" | "policies" | "audit";

function Bounds(props: { grant: GrantRecord; }) {
  if (!props.grant.bounds || props.grant.bounds.length === 0) {
    return <span className="authz-muted">unbounded</span>;
  }
  return (
    <>
      {props.grant.bounds.map((b, i) => (
        <span className="authz-chip" key={i}>
          {b.key} {b.operator} {b.values ? b.values.join(", ") : b.value}
        </span>
      ))}
    </>
  );
}

function GrantsTable(props: { grants: GrantRecord[]; onRevoke(id: string): void; }) {
  if (props.grants.length === 0) return <p className="authz-muted">No grants.</p>;
  return (
    <table className="authz-table">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Policy</th>
          <th>Scope</th>
          <th>Bounds</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {props.grants.map((g) => (
          <tr key={g.id}>
            <td>{g.subject.kind}:{g.subject.id}</td>
            <td>{g.policyName}</td>
            <td>{g.scope.kind}:{g.scope.id}</td>
            <td>
              <Bounds grant={g} />
            </td>
            <td>
              <button
                className="authz-button"
                data-variant="danger"
                type="button"
                onClick={() => props.onRevoke(g.id)}
              >
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PoliciesTable(props: { descriptor: AuthzDescriptor; policies: PolicyRecord[]; }) {
  return (
    <table className="authz-table">
      <thead>
        <tr>
          <th>Policy</th>
          <th>Confers</th>
          <th>Excludes</th>
        </tr>
      </thead>
      <tbody>
        {props.policies.map((p) => {
          const { granted, excluded } = coverageOf(props.descriptor, p.statements);
          return (
            <tr key={p.id}>
              <td>
                {p.name}
                {p.system && <span className="authz-chip">managed</span>}
                {p.description && <div className="authz-muted">{p.description}</div>}
              </td>
              <td>{granted.map((a) => <span className="authz-chip" key={a}>{a}</span>)}</td>
              <td>{excluded.map((a) => <span className="authz-chip" key={a}>{a}</span>)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AuditTable(props: { rows: AdminAuditRecord[]; }) {
  if (props.rows.length === 0) return <p className="authz-muted">No audit rows.</p>;
  return (
    <table className="authz-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Subject</th>
          <th>Decision</th>
          <th>Action</th>
          <th>Resource</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={r.id}>
            <td>{r.at}</td>
            <td>{r.subject.kind}:{r.subject.id}</td>
            <td>{r.decision}</td>
            <td>{r.action}</td>
            <td>{r.resource}</td>
            <td>{r.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The whole integration, identically, for every host. It imports no host
// vocabulary: everything project-specific arrives at runtime in the descriptor.
export function AuthzAdmin(props: AuthzAdminProps) {
  const admin = useAuthzAdmin({ baseUrl: props.baseUrl, fetch: props.fetch });
  const [tab, setTab] = useState<Tab>("grants");

  useEffect(() => {
    if (tab === "audit") void admin.loadAudit();
  }, [tab]);

  const tabs: Tab[] = ["grants", "policies", "audit"];

  return (
    <div className={`authz-admin${props.className ? ` ${props.className}` : ""}`}>
      <style>{AUTHZ_STYLES}</style>

      {admin.error && <div className="authz-error" role="alert">{admin.error}</div>}

      {admin.loading && <p className="authz-muted">Loading…</p>}

      {admin.descriptor && (
        <>
          <div className="authz-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t}
                className="authz-tab"
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="authz-panel" role="tabpanel">
            {tab === "grants" && (
              <>
                <GrantsTable grants={admin.grants} onRevoke={(id) => void admin.revokeGrant(id)} />
                <h3>New grant</h3>
                <GrantEditor
                  descriptor={admin.descriptor}
                  policies={admin.policies}
                  searchSubjects={admin.searchSubjects}
                  onCreate={admin.createGrant}
                />
              </>
            )}
            {tab === "policies" && (
              <PoliciesTable descriptor={admin.descriptor} policies={admin.policies} />
            )}
            {tab === "audit" && <AuditTable rows={admin.audit} />}
          </div>
        </>
      )}
    </div>
  );
}
