import type { AuthzDescriptor } from "../model/descriptor.js";
import { boundFields, controlFor, type DraftBound } from "./derive.js";

export interface BoundsEditorProps {
  descriptor: AuthzDescriptor;
  bounds: DraftBound[];
  onChange(next: DraftBound[]): void;
}

const INPUT_TYPE: Record<string, string> = {
  text: "text",
  number: "number",
  datetime: "datetime-local",
  cidr: "text",
};

const PLACEHOLDER: Record<string, string> = {
  cidr: "10.0.0.0/8",
  datetime: "2026-01-01T00:00",
};

// Every field here comes from a declared condition key. Nothing is written per
// host: declaring a key server-side produces a new option with no change here.
export function BoundsEditor(props: BoundsEditorProps) {
  const { descriptor, bounds, onChange } = props;
  const fields = boundFields(descriptor).filter((f) => f.selectable);

  const patch = (i: number, next: Partial<DraftBound>) =>
    onChange(bounds.map((b, j) => j === i ? { ...b, ...next } : b));

  const addBound = () => {
    const first = fields[0];
    if (!first) return;
    onChange([...bounds, {
      key: first.key,
      operator: first.spec.operators[0] ?? "",
      value: "",
      values: [""],
    }]);
  };

  if (fields.length === 0) {
    return (
      <p className="authz-muted">This host declares no condition keys, so a grant has no bounds.</p>
    );
  }

  return (
    <div>
      {bounds.map((bound, i) => {
        const spec = descriptor.conditionKeys[bound.key];
        if (!spec) return null;
        const control = controlFor(spec, bound.operator, descriptor.setOperators);
        return (
          <div className="authz-row" key={i} data-testid="bound-row">
            <select
              className="authz-select"
              aria-label="Condition key"
              value={bound.key}
              onChange={(e) => {
                const next = descriptor.conditionKeys[e.target.value];
                patch(i, {
                  key: e.target.value,
                  operator: next?.operators[0] ?? "",
                });
              }}
            >
              {fields.map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
            </select>

            <select
              className="authz-select"
              aria-label="Operator"
              value={bound.operator}
              onChange={(e) => patch(i, { operator: e.target.value })}
            >
              {spec.operators.map((op) => <option key={op} value={op}>{op}</option>)}
            </select>

            {control === "multi"
              ? (
                <input
                  className="authz-input"
                  aria-label="Values"
                  data-control="multi"
                  placeholder="comma separated"
                  value={bound.values.join(",")}
                  onChange={(e) =>
                    patch(i, { values: e.target.value.split(",").map((v) => v.trim()) })}
                />
              )
              : (
                <input
                  className="authz-input"
                  aria-label="Value"
                  data-control={control}
                  type={INPUT_TYPE[control] ?? "text"}
                  placeholder={PLACEHOLDER[control] ?? ""}
                  value={bound.value}
                  onChange={(e) => patch(i, { value: e.target.value })}
                />
              )}

            <button
              className="authz-button"
              data-variant="ghost"
              type="button"
              onClick={() => onChange(bounds.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        );
      })}
      <button className="authz-button" data-variant="ghost" type="button" onClick={addBound}>
        Add bound
      </button>
    </div>
  );
}
