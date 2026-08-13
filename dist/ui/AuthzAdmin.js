import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { coverageOf } from "./derive.js";
import { GrantEditor } from "./GrantEditor.js";
import { AUTHZ_STYLES } from "./styles.js";
import { useAuthzAdmin } from "./useAuthzAdmin.js";
function Bounds(props) {
    if (!props.grant.bounds || props.grant.bounds.length === 0) {
        return _jsx("span", { className: "authz-muted", children: "unbounded" });
    }
    return (_jsx(_Fragment, { children: props.grant.bounds.map((b, i) => (_jsxs("span", { className: "authz-chip", children: [b.key, " ", b.operator, " ", b.values ? b.values.join(", ") : b.value] }, i))) }));
}
function GrantsTable(props) {
    if (props.grants.length === 0)
        return _jsx("p", { className: "authz-muted", children: "No grants." });
    return (_jsxs("table", { className: "authz-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Subject" }), _jsx("th", { children: "Policy" }), _jsx("th", { children: "Scope" }), _jsx("th", { children: "Bounds" }), _jsx("th", {})] }) }), _jsx("tbody", { children: props.grants.map((g) => (_jsxs("tr", { children: [_jsxs("td", { children: [g.subject.kind, ":", g.subject.id] }), _jsx("td", { children: g.policyName }), _jsxs("td", { children: [g.scope.kind, ":", g.scope.id] }), _jsx("td", { children: _jsx(Bounds, { grant: g }) }), _jsx("td", { children: _jsx("button", { className: "authz-button", "data-variant": "danger", type: "button", onClick: () => props.onRevoke(g.id), children: "Revoke" }) })] }, g.id))) })] }));
}
function PoliciesTable(props) {
    return (_jsxs("table", { className: "authz-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Policy" }), _jsx("th", { children: "Confers" }), _jsx("th", { children: "Excludes" })] }) }), _jsx("tbody", { children: props.policies.map((p) => {
                    const { granted, excluded } = coverageOf(props.descriptor, p.statements);
                    return (_jsxs("tr", { children: [_jsxs("td", { children: [p.name, p.system && _jsx("span", { className: "authz-chip", children: "managed" }), p.description && _jsx("div", { className: "authz-muted", children: p.description })] }), _jsx("td", { children: granted.map((a) => _jsx("span", { className: "authz-chip", children: a }, a)) }), _jsx("td", { children: excluded.map((a) => _jsx("span", { className: "authz-chip", children: a }, a)) })] }, p.id));
                }) })] }));
}
function AuditTable(props) {
    if (props.rows.length === 0)
        return _jsx("p", { className: "authz-muted", children: "No audit rows." });
    return (_jsxs("table", { className: "authz-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "When" }), _jsx("th", { children: "Subject" }), _jsx("th", { children: "Decision" }), _jsx("th", { children: "Action" }), _jsx("th", { children: "Resource" }), _jsx("th", { children: "Source" })] }) }), _jsx("tbody", { children: props.rows.map((r) => (_jsxs("tr", { children: [_jsx("td", { children: r.at }), _jsxs("td", { children: [r.subject.kind, ":", r.subject.id] }), _jsx("td", { children: r.decision }), _jsx("td", { children: r.action }), _jsx("td", { children: r.resource }), _jsx("td", { children: r.source })] }, r.id))) })] }));
}
// The whole integration, identically, for every host. It imports no host
// vocabulary: everything project-specific arrives at runtime in the descriptor.
export function AuthzAdmin(props) {
    const admin = useAuthzAdmin({ baseUrl: props.baseUrl, fetch: props.fetch });
    const [tab, setTab] = useState("grants");
    useEffect(() => {
        if (tab === "audit")
            void admin.loadAudit();
    }, [tab]);
    const tabs = ["grants", "policies", "audit"];
    return (_jsxs("div", { className: `authz-admin${props.className ? ` ${props.className}` : ""}`, children: [_jsx("style", { children: AUTHZ_STYLES }), admin.error && _jsx("div", { className: "authz-error", role: "alert", children: admin.error }), admin.loading && _jsx("p", { className: "authz-muted", children: "Loading\u2026" }), admin.descriptor && (_jsxs(_Fragment, { children: [_jsx("div", { className: "authz-tabs", role: "tablist", children: tabs.map((t) => (_jsx("button", { className: "authz-tab", role: "tab", type: "button", "aria-selected": tab === t, onClick: () => setTab(t), children: t }, t))) }), _jsxs("div", { className: "authz-panel", role: "tabpanel", children: [tab === "grants" && (_jsxs(_Fragment, { children: [_jsx(GrantsTable, { grants: admin.grants, onRevoke: (id) => void admin.revokeGrant(id) }), _jsx("h3", { children: "New grant" }), _jsx(GrantEditor, { descriptor: admin.descriptor, policies: admin.policies, searchSubjects: admin.searchSubjects, onCreate: admin.createGrant })] })), tab === "policies" && (_jsx(PoliciesTable, { descriptor: admin.descriptor, policies: admin.policies })), tab === "audit" && _jsx(AuditTable, { rows: admin.audit })] })] }))] }));
}
//# sourceMappingURL=AuthzAdmin.js.map