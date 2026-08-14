// A complete, self-contained host: vocabulary, engine, admin surface, and a
// static admin UI — in memory, so it runs with nothing but bun.
//
//   bun run server.ts     →  http://localhost:8787

import type { AdminAuditRecord, AdminStore } from "@neutroncore/authz/admin";
import { createAdminHandler } from "@neutroncore/authz/admin";
import { describeAuthz, makeAuthz, validateStatements } from "@neutroncore/authz/core";
import { resolveConditionKeys } from "@neutroncore/authz/core";
import type {
  GrantBounds,
  GrantRecord,
  PolicyRecord,
  PolicyStatement,
  ResolvedGrant,
  Scope,
  ScopeChain,
  Subject,
} from "@neutroncore/authz/model";
import { actionRegistryFromCatalogue } from "@neutroncore/authz/ports";
import type { AuditEvent } from "@neutroncore/authz/ports";

const ui = await Bun.file(new URL("./ui.html", import.meta.url)).text();

// ---------------------------------------------------------------------------
// 1. The vocabulary — the ONLY part that is specific to this host
// ---------------------------------------------------------------------------

const actionRegistry = actionRegistryFromCatalogue([
  { action: "articles.read", title: "Read articles" },
  { action: "articles.list", derivesFrom: "articles.read", title: "List articles" },
  { action: "articles.write", derivesFrom: "articles.read", title: "Write articles" },
  { action: "articles.publish", derivesFrom: "articles.write", title: "Publish articles" },
  { action: "billing.read", title: "View billing" },
]);

const conditionKeys = {
  "app:Region": { type: "string" as const },
  "app:MaxDrafts": { type: "number" as const },
};

const scopeKinds = ["root", "site"];
const ROOT: Scope = { kind: "root", id: "*" };

// ---------------------------------------------------------------------------
// 2. An in-memory AdminStore + GrantStore + AuditSink — ~100 lines is the
//    whole port surface. Swap for PgAuthzStore and nothing else changes.
// ---------------------------------------------------------------------------

class MemoryAdminStore implements AdminStore {
  private policies = new Map<string, PolicyRecord>();
  private grants: GrantRecord[] = [];
  private audit: AdminAuditRecord[] = [];
  private n = 0;

  seedPolicy(name: string, description: string, statements: PolicyStatement[]): PolicyRecord {
    const p: PolicyRecord = {
      id: `p${++this.n}`,
      name,
      description,
      statements,
      system: true,
      updatedAt: new Date().toISOString(),
    };
    this.policies.set(p.id, p);
    return p;
  }

  async listPolicies(): Promise<PolicyRecord[]> {
    return [...this.policies.values()];
  }

  async listGrants(filter: {
    scopeKind?: string;
    scopeId?: string;
    policyId?: string;
    subjectKind?: string;
    subjectId?: string;
  }): Promise<GrantRecord[]> {
    return this.grants.filter((g) =>
      (!filter.policyId || g.policyId === filter.policyId)
      && (!filter.scopeKind || g.scope.kind === filter.scopeKind)
      && (!filter.scopeId || g.scope.id === filter.scopeId)
      && (!filter.subjectKind || g.subject.kind === filter.subjectKind)
      && (!filter.subjectId || g.subject.id === filter.subjectId)
    );
  }

  async createGrant(input: {
    policyId: string;
    subject: Subject;
    scope: Scope;
    bounds?: GrantBounds;
    createdBy: string | null;
  }): Promise<void> {
    const policy = this.policies.get(input.policyId);
    if (!policy) throw new Error(`unknown policy ${input.policyId}`);
    const existing = this.grants.find((g) =>
      g.policyId === input.policyId
      && g.subject.kind === input.subject.kind && g.subject.id === input.subject.id
      && g.scope.kind === input.scope.kind && g.scope.id === input.scope.id
    );
    if (existing) {
      // Replace bounds, matching the pg backend: tightening must take effect.
      if (input.bounds === undefined) delete existing.bounds;
      else existing.bounds = input.bounds;
      return;
    }
    this.grants.push({
      id: `g${++this.n}`,
      policyId: policy.id,
      policyName: policy.name,
      subject: input.subject,
      scope: input.scope,
      ...(input.bounds !== undefined ? { bounds: input.bounds } : {}),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    });
  }

  async deleteGrant(id: string): Promise<boolean> {
    const i = this.grants.findIndex((g) => g.id === id);
    if (i === -1) return false;
    this.grants.splice(i, 1);
    return true;
  }

  async deleteGrantsForSubject(subject: Subject): Promise<number> {
    const before = this.grants.length;
    this.grants = this.grants.filter((g) =>
      g.subject.kind !== subject.kind || g.subject.id !== subject.id
    );
    return before - this.grants.length;
  }

  async deleteGrantsForPolicy(policyId: string): Promise<number> {
    const before = this.grants.length;
    this.grants = this.grants.filter((g) => g.policyId !== policyId);
    return before - this.grants.length;
  }

  // Evaluation-facing lookup (the GrantSource port): exactly the grants whose
  // subject AND scope match.
  async grantsFor(subjects: readonly Subject[], chain: ScopeChain): Promise<ResolvedGrant[]> {
    return this.grants
      .filter((g) =>
        subjects.some((s) => s.kind === g.subject.kind && s.id === g.subject.id)
        && chain.some((s) => s.kind === g.scope.kind && s.id === g.scope.id)
      )
      .map((g) => ({
        policyId: g.policyId,
        policyName: g.policyName,
        subject: g.subject,
        scope: g.scope,
        statements: this.policies.get(g.policyId)!.statements,
        ...(g.bounds !== undefined ? { bounds: g.bounds } : {}),
      }));
  }

  record(event: AuditEvent): void {
    this.audit.unshift({
      id: `a${++this.n}`,
      at: new Date().toISOString(),
      subject: event.subjects[0] ?? { kind: "anonymous", id: "anonymous" },
      action: event.action,
      resource: event.resource,
      decision: event.decision,
      source: event.source,
      detail: event.detail,
    });
  }

  async listAudit(opts: { subjectId?: string; action?: string; limit?: number; }): Promise<
    AdminAuditRecord[]
  > {
    return this.audit
      .filter((r) =>
        (!opts.subjectId || r.subject.id.includes(opts.subjectId))
        && (!opts.action || r.action.includes(opts.action))
      )
      .slice(0, Math.min(opts.limit ?? 50, 200));
  }
}

// ---------------------------------------------------------------------------
// 3. Seed two curated policies and wire everything up
// ---------------------------------------------------------------------------

const store = new MemoryAdminStore();

const seed = (name: string, description: string, statements: unknown) => {
  const v = validateStatements(statements, {
    isKnownAction: actionRegistry.isKnownAction,
    conditionKeys: resolveConditionKeys(conditionKeys),
  });
  if (!v.ok) throw new Error(`seed policy ${name}: ${v.error}`);
  return store.seedPolicy(name, description, v.statements);
};

seed("article-author", "Write and publish articles", [
  { effect: "allow", actions: ["articles.write"], resources: ["article:*"] },
  { effect: "deny", actions: ["billing.read"], resources: ["*"] },
]);
seed("viewer", "Read-only access", [
  { effect: "allow", actions: ["articles.read"], resources: ["*"] },
]);

const authz = makeAuthz({
  grantStore: store,
  auditSink: store,
  actionRegistry,
  conditionKeys,
  scopeKinds,
  defaultScopeChain: [ROOT],
});

const descriptor = describeAuthz({ actionRegistry, conditionKeys, scopeKinds });

const admin = createAdminHandler({
  descriptor,
  store,
  basePath: "/api/authz",
  // A real host resolves this from its session. The example trusts a header
  // so the UI stays a static file.
  actor: (req) => {
    const who = req.headers.get("x-demo-admin");
    return who ? { kind: "user", id: who } : null;
  },
  auditSink: store,
  subjects: {
    list: async ({ q }) =>
      [
        { kind: "user", id: "alice", label: "Alice" },
        { kind: "user", id: "bob", label: "Bob" },
        { kind: "agent", id: "publish-bot", label: "Publish bot" },
      ].filter((s) => !q || s.id.includes(q)),
  },
});

// ---------------------------------------------------------------------------
// 4. Serve: the admin API, a /check probe, and the static UI
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/authz")) return admin(req);
    if (url.pathname === "/api/check" && req.method === "POST") {
      const b = await req.json() as {
        subject: Subject;
        action: string;
        resource: string;
        context?: Record<string, string | number>;
      };
      const allowed = await authz.check([b.subject], b.action, b.resource, {
        context: b.context,
        source: "demo-probe",
      });
      return Response.json({ allowed });
    }
    return new Response(ui, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`example host on ${server.url}`);
