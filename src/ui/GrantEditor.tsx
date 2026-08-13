import { useState } from "react";
import type { SubjectSummary } from "../admin/types.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { PolicyRecord } from "../model/grant.js";
import { BoundsEditor } from "./BoundsEditor.js";
import { coverageOf, type DraftBound, toCondition } from "./derive.js";

export interface GrantEditorProps {
  descriptor: AuthzDescriptor;
  policies: PolicyRecord[];
  searchSubjects(q: string): Promise<SubjectSummary[]>;
  onCreate(input: {
    policyId: string;
    subject: { kind: string; id: string; };
    scope: { kind: string; id: string; };
    bounds?: ReturnType<typeof toCondition>[];
  }): Promise<void>;
}

function Coverage(props: { descriptor: AuthzDescriptor; policy: PolicyRecord | undefined; }) {
  if (!props.policy) return null;
  const { granted, excluded } = coverageOf(props.descriptor, props.policy.statements);
  return (
    <div className="authz-coverage" data-testid="coverage">
      <div className="authz-muted">This grant confers</div>
      {granted.length === 0
        ? <div className="authz-muted">nothing</div>
        : granted.map((a) => <span className="authz-chip" key={a}>{a}</span>)}
      {excluded.length > 0 && (
        <>
          <div className="authz-muted">and explicitly excludes</div>
          {excluded.map((a) => <span className="authz-chip" key={a}>{a}</span>)}
        </>
      )}
    </div>
  );
}

export function GrantEditor(props: GrantEditorProps) {
  const { descriptor, policies } = props;
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [subjectKind, setSubjectKind] = useState("user");
  const [subjectId, setSubjectId] = useState("");
  const [matches, setMatches] = useState<SubjectSummary[]>([]);
  const [scopeKind, setScopeKind] = useState(descriptor.scopeKinds[0] ?? "");
  const [scopeId, setScopeId] = useState("");
  const [bounds, setBounds] = useState<DraftBound[]>([]);
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
    } finally {
      setBusy(false);
    }
  };

  const search = async (q: string) => {
    setSubjectId(q);
    setMatches(q.length > 0 ? await props.searchSubjects(q) : []);
  };

  return (
    <div>
      <div className="authz-field">
        <label htmlFor="authz-policy">Policy</label>
        <select
          id="authz-policy"
          className="authz-select"
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
        >
          {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="authz-row">
        <div className="authz-field">
          <label htmlFor="authz-subject-kind">Subject kind</label>
          <input
            id="authz-subject-kind"
            className="authz-input"
            value={subjectKind}
            onChange={(e) => setSubjectKind(e.target.value)}
          />
        </div>
        <div className="authz-field">
          <label htmlFor="authz-subject-id">Subject</label>
          <input
            id="authz-subject-id"
            className="authz-input"
            list="authz-subject-matches"
            value={subjectId}
            onChange={(e) => void search(e.target.value)}
          />
          <datalist id="authz-subject-matches">
            {matches.map((m) => (
              <option key={`${m.kind}:${m.id}`} value={m.id}>{m.label ?? m.id}</option>
            ))}
          </datalist>
        </div>
      </div>

      <div className="authz-row">
        <div className="authz-field">
          <label htmlFor="authz-scope-kind">Scope kind</label>
          <select
            id="authz-scope-kind"
            className="authz-select"
            value={scopeKind}
            onChange={(e) => setScopeKind(e.target.value)}
          >
            {descriptor.scopeKinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="authz-field">
          <label htmlFor="authz-scope-id">Scope id</label>
          <input
            id="authz-scope-id"
            className="authz-input"
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
          />
        </div>
      </div>

      <div className="authz-field">
        <label>Bounds</label>
        <BoundsEditor descriptor={descriptor} bounds={bounds} onChange={setBounds} />
      </div>

      <Coverage descriptor={descriptor} policy={policies.find((p) => p.id === policyId)} />

      <p>
        <button
          className="authz-button"
          type="button"
          disabled={busy || !policyId || !subjectId || !scopeId}
          onClick={() => void submit()}
        >
          Grant
        </button>
      </p>
    </div>
  );
}
