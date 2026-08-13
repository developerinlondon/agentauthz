import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { boundFields, controlFor } from "./derive.js";
const INPUT_TYPE = {
    text: "text",
    number: "number",
    datetime: "datetime-local",
    cidr: "text",
};
const PLACEHOLDER = {
    cidr: "10.0.0.0/8",
    datetime: "2026-01-01T00:00",
};
// Every field here comes from a declared condition key. Nothing is written per
// host: declaring a key server-side produces a new option with no change here.
export function BoundsEditor(props) {
    const { descriptor, bounds, onChange } = props;
    const fields = boundFields(descriptor).filter((f) => f.selectable);
    const patch = (i, next) => onChange(bounds.map((b, j) => j === i ? { ...b, ...next } : b));
    const addBound = () => {
        const first = fields[0];
        if (!first)
            return;
        onChange([...bounds, {
                key: first.key,
                operator: first.spec.operators[0] ?? "",
                value: "",
                values: [""],
            }]);
    };
    if (fields.length === 0) {
        return (_jsx("p", { className: "authz-muted", children: "This host declares no condition keys, so a grant has no bounds." }));
    }
    return (_jsxs("div", { children: [bounds.map((bound, i) => {
                const spec = descriptor.conditionKeys[bound.key];
                if (!spec)
                    return null;
                const control = controlFor(spec, bound.operator, descriptor.setOperators);
                return (_jsxs("div", { className: "authz-row", "data-testid": "bound-row", children: [_jsx("select", { className: "authz-select", "aria-label": "Condition key", value: bound.key, onChange: (e) => {
                                const next = descriptor.conditionKeys[e.target.value];
                                patch(i, {
                                    key: e.target.value,
                                    operator: next?.operators[0] ?? "",
                                });
                            }, children: fields.map((f) => _jsx("option", { value: f.key, children: f.key }, f.key)) }), _jsx("select", { className: "authz-select", "aria-label": "Operator", value: bound.operator, onChange: (e) => patch(i, { operator: e.target.value }), children: spec.operators.map((op) => _jsx("option", { value: op, children: op }, op)) }), control === "multi"
                            ? (_jsx("input", { className: "authz-input", "aria-label": "Values", "data-control": "multi", placeholder: "comma separated", value: bound.values.join(","), onChange: (e) => patch(i, { values: e.target.value.split(",").map((v) => v.trim()) }) }))
                            : (_jsx("input", { className: "authz-input", "aria-label": "Value", "data-control": control, type: INPUT_TYPE[control] ?? "text", placeholder: PLACEHOLDER[control] ?? "", value: bound.value, onChange: (e) => patch(i, { value: e.target.value }) })), _jsx("button", { className: "authz-button", "data-variant": "ghost", type: "button", onClick: () => onChange(bounds.filter((_, j) => j !== i)), children: "Remove" })] }, i));
            }), _jsx("button", { className: "authz-button", "data-variant": "ghost", type: "button", onClick: addBound, children: "Add bound" })] }));
}
//# sourceMappingURL=BoundsEditor.js.map