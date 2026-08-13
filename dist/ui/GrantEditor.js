import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { BoundsEditor } from "./BoundsEditor.js";
import { coverageOf, toCondition } from "./derive.js";
function Coverage(props) {
    if (!props.policy)
        return null;
    const { granted, excluded } = coverageOf(props.descriptor, props.policy.statements);
    return (_jsxs("div", { className: "authz-coverage", "data-testid": "coverage", children: [_jsx("div", { className: "authz-muted", children: "This grant confers" }), granted.length === 0
                ? _jsx("div", { className: "authz-muted", children: "nothing" })
                : granted.map((a) => _jsx("span", { className: "authz-chip", children: a }, a)), excluded.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "authz-muted", children: "and explicitly excludes" }), excluded.map((a) => _jsx("span", { className: "authz-chip", children: a }, a))] }))] }));
}
export function GrantEditor(props) {
    const { descriptor, policies } = props;
    const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
    const [subjectKind, setSubjectKind] = useState("user");
    const [subjectId, setSubjectId] = useState("");
    const [matches, setMatches] = useState([]);
    const [scopeKind, setScopeKind] = useState(descriptor.scopeKinds[0] ?? "");
    const [scopeId, setScopeId] = useState("");
    const [bounds, setBounds] = useState([]);
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        setBusy(true);
        try {
            const conditions = bounds.map((b) => toCondition(b, descriptor.setOperators));
            await props.onCreate({
                policyId,
                subject: { kind: subjectKind, id: subjectId },
                scope: { kind: scopeKind, id: scopeId },
                ...(conditions.length > 0 ? { bounds: conditions } : {}),
            });
            setSubjectId("");
            setScopeId("");
            setBounds([]);
        }
        finally {
            setBusy(false);
        }
    };
    const search = async (q) => {
        setSubjectId(q);
        setMatches(q.length > 0 ? await props.searchSubjects(q) : []);
    };
    return (_jsxs("div", { children: [_jsxs("div", { className: "authz-field", children: [_jsx("label", { htmlFor: "authz-policy", children: "Policy" }), _jsx("select", { id: "authz-policy", className: "authz-select", value: policyId, onChange: (e) => setPolicyId(e.target.value), children: policies.map((p) => _jsx("option", { value: p.id, children: p.name }, p.id)) })] }), _jsxs("div", { className: "authz-row", children: [_jsxs("div", { className: "authz-field", children: [_jsx("label", { htmlFor: "authz-subject-kind", children: "Subject kind" }), _jsx("input", { id: "authz-subject-kind", className: "authz-input", value: subjectKind, onChange: (e) => setSubjectKind(e.target.value) })] }), _jsxs("div", { className: "authz-field", children: [_jsx("label", { htmlFor: "authz-subject-id", children: "Subject" }), _jsx("input", { id: "authz-subject-id", className: "authz-input", list: "authz-subject-matches", value: subjectId, onChange: (e) => void search(e.target.value) }), _jsx("datalist", { id: "authz-subject-matches", children: matches.map((m) => (_jsx("option", { value: m.id, children: m.label ?? m.id }, `${m.kind}:${m.id}`))) })] })] }), _jsxs("div", { className: "authz-row", children: [_jsxs("div", { className: "authz-field", children: [_jsx("label", { htmlFor: "authz-scope-kind", children: "Scope kind" }), _jsx("select", { id: "authz-scope-kind", className: "authz-select", value: scopeKind, onChange: (e) => setScopeKind(e.target.value), children: descriptor.scopeKinds.map((k) => _jsx("option", { value: k, children: k }, k)) })] }), _jsxs("div", { className: "authz-field", children: [_jsx("label", { htmlFor: "authz-scope-id", children: "Scope id" }), _jsx("input", { id: "authz-scope-id", className: "authz-input", value: scopeId, onChange: (e) => setScopeId(e.target.value) })] })] }), _jsxs("div", { className: "authz-field", children: [_jsx("label", { children: "Bounds" }), _jsx(BoundsEditor, { descriptor: descriptor, bounds: bounds, onChange: setBounds })] }), _jsx(Coverage, { descriptor: descriptor, policy: policies.find((p) => p.id === policyId) }), _jsx("p", { children: _jsx("button", { className: "authz-button", type: "button", disabled: busy || !policyId || !subjectId || !scopeId, onClick: () => void submit(), children: "Grant" }) })] }));
}
//# sourceMappingURL=GrantEditor.js.map