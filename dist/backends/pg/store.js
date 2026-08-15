import { sql } from "kysely";
import { AuthzError } from "../../model/errors.js";
// The reference Kysely adapter: the ONLY code that reads/writes the authz_*
// tables (the seam-first constraint — an alternative backend implements the
// same ports without touching call sites). Policy CRUD + grant storage +
// audit live here; statement/condition VALIDATION is the caller's job
// (core/validate.ts) before anything reaches this store; evaluation (union,
// deny-wins) is core/evaluate.ts.
// Thrown by updatePolicy/deletePolicy when the target is `system`: a curated,
// immutable managed policy. Hosts map this to 400/403 — attach and
// duplicate-to-customize stay open.
export class SystemPolicyError extends AuthzError {
}
const POLICY_COLUMNS = ["id", "name", "description", "statements", "system", "updated_at"];
function iso(value) {
    return value instanceof Date ? value.toISOString() : String(value);
}
function policyRecord(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        statements: row.statements,
        system: row.system,
        updatedAt: iso(row.updated_at),
    };
}
export class PgAuthzStore {
    config;
    db;
    retentionDays;
    // In-flight fire-and-forget audit inserts. Never awaited on the request
    // path; exposed via flushAudit() so tests (and a graceful shutdown) can
    // drain them.
    inflight = new Set();
    // Takes the HOST's own Kysely instance — the authz_* tables live in the
    // host's database, never a separate one.
    constructor(db, config) {
        this.config = config;
        this.db = db;
        this.retentionDays = config.auditRetentionDays ?? 90;
    }
    // -------------------------------------------------------------------------
    // Evaluation-facing grant lookup (the GrantSource port)
    // -------------------------------------------------------------------------
    // Every grant applicable to (subjects, scopeChain): the union over the
    // resolved chain. This is the evaluator's single stored-grant source;
    // core applies deny-wins over the union, so inheritance can only ever ADD
    // statements to consider — a leaf grant never leaks upward or sideways
    // because a sibling's chain never contains that leaf.
    async grantsFor(subjects, scopeChain) {
        if (subjects.length === 0 || scopeChain.length === 0)
            return [];
        const rows = await this.db.selectFrom("authz_grants")
            .innerJoin("authz_policies", "authz_policies.id", "authz_grants.policy_id")
            .select([
            "authz_grants.policy_id as policy_id",
            "authz_policies.name as policy_name",
            "authz_policies.statements as statements",
            "authz_grants.subject_kind as subject_kind",
            "authz_grants.subject_id as subject_id",
            "authz_grants.scope_kind as scope_kind",
            "authz_grants.scope_id as scope_id",
            "authz_grants.bounds as bounds",
        ])
            .where((eb) => eb.or(subjects.map((s) => eb.and([
            eb("authz_grants.subject_kind", "=", s.kind),
            eb("authz_grants.subject_id", "=", s.id),
        ]))))
            .where((eb) => eb.or(scopeChain.map((s) => eb.and([
            eb("authz_grants.scope_kind", "=", s.kind),
            eb("authz_grants.scope_id", "=", s.id),
        ]))))
            .execute();
        return rows.map((r) => ({
            policyId: r.policy_id,
            policyName: r.policy_name,
            subject: { kind: r.subject_kind, id: r.subject_id },
            scope: { kind: r.scope_kind, id: r.scope_id },
            statements: r.statements,
            ...(r.bounds === null || r.bounds === undefined
                ? {}
                : { bounds: r.bounds }),
        }));
    }
    // -------------------------------------------------------------------------
    // Grant management
    // -------------------------------------------------------------------------
    // Idempotent (authz_grants_unique): re-granting the same (policy, subject,
    // scope) is a no-op. A root-kind scope is normalized to the canonical root
    // id.
    async createGrant(input) {
        const bounds = input.bounds === undefined ? null : JSON.stringify(input.bounds);
        await this.db.insertInto("authz_grants")
            .values({
            id: crypto.randomUUID(),
            policy_id: input.policyId,
            subject_kind: input.subject.kind,
            subject_id: input.subject.id,
            scope_kind: input.scope.kind,
            scope_id: input.scope.kind === this.config.rootScope.kind
                ? this.config.rootScope.id
                : input.scope.id,
            bounds,
            created_by: input.createdBy,
        })
            // Bounds are UPDATED on conflict rather than ignored: an admin
            // re-granting to tighten a limit must not silently keep the old one.
            .onConflict((oc) => oc.columns(["policy_id", "subject_kind", "subject_id", "scope_kind", "scope_id"])
            .doUpdateSet({ bounds }))
            .execute();
    }
    async getGrant(id) {
        const row = await this.grantQuery().where("authz_grants.id", "=", id).executeTakeFirst();
        return row ? this.grantRecord(row) : null;
    }
    async listGrants(filter = {}) {
        let q = this.grantQuery();
        if (filter.scopeKind)
            q = q.where("authz_grants.scope_kind", "=", filter.scopeKind);
        if (filter.scopeId !== undefined)
            q = q.where("authz_grants.scope_id", "=", filter.scopeId);
        if (filter.policyId)
            q = q.where("authz_grants.policy_id", "=", filter.policyId);
        if (filter.subjectKind)
            q = q.where("authz_grants.subject_kind", "=", filter.subjectKind);
        if (filter.subjectId)
            q = q.where("authz_grants.subject_id", "=", filter.subjectId);
        const rows = await q
            .orderBy("authz_grants.scope_kind", "asc").orderBy("authz_grants.scope_id", "asc")
            .orderBy("authz_grants.subject_kind", "asc").orderBy("authz_grants.subject_id", "asc")
            .execute();
        return rows.map((r) => this.grantRecord(r));
    }
    async deleteGrant(id) {
        const r = await this.db.deleteFrom("authz_grants").where("id", "=", id).executeTakeFirst();
        return Number(r.numDeletedRows) > 0;
    }
    // The flat shape at a fixed (policy, subject, scope) — backs detachPolicy.
    async deleteGrantAt(policyId, subject, scope) {
        const r = await this.db.deleteFrom("authz_grants")
            .where("policy_id", "=", policyId)
            .where("subject_kind", "=", subject.kind)
            .where("subject_id", "=", subject.id)
            .where("scope_kind", "=", scope.kind)
            .where("scope_id", "=", scope.id)
            .executeTakeFirst();
        return Number(r.numDeletedRows) > 0;
    }
    // Revocation: remove a subject's grants at EVERY scope, not just the root —
    // a revoked subject must not keep a deep-scope grant waiting for a future
    // same-named subject.
    async deleteGrantsForSubject(subject) {
        const r = await this.db.deleteFrom("authz_grants")
            .where("subject_kind", "=", subject.kind)
            .where("subject_id", "=", subject.id)
            .executeTakeFirst();
        return Number(r.numDeletedRows ?? 0);
    }
    async deleteGrantsForPolicy(policyId) {
        const r = await this.db.deleteFrom("authz_grants")
            .where("policy_id", "=", policyId)
            .executeTakeFirst();
        return Number(r.numDeletedRows ?? 0);
    }
    // The legacy flat-attachment sugar: an attachment IS a grant at the root.
    async attachPolicy(policyId, subject) {
        await this.createGrant({
            policyId,
            subject,
            scope: this.config.rootScope,
            createdBy: null,
        });
    }
    async detachPolicy(policyId, subject) {
        return await this.deleteGrantAt(policyId, subject, this.config.rootScope);
    }
    async listAttachments(policyId) {
        const rows = await this.listGrants({ policyId, scopeKind: this.config.rootScope.kind });
        return rows.map((r) => r.subject);
    }
    // -------------------------------------------------------------------------
    // Policy CRUD
    // -------------------------------------------------------------------------
    // Throws on a duplicate name (unique constraint). `system` is never a
    // caller input — only a host seed/migration creates a managed policy; every
    // policy created through this function is a normal, editable one.
    async createPolicy(input) {
        const row = await this.db.insertInto("authz_policies")
            .values({
            id: crypto.randomUUID(),
            name: input.name,
            description: input.description,
            statements: JSON.stringify(input.statements),
            created_by: input.createdBy,
        })
            .returning([...POLICY_COLUMNS])
            .executeTakeFirstOrThrow();
        return policyRecord(row);
    }
    async getPolicy(id) {
        const row = await this.db.selectFrom("authz_policies")
            .select([...POLICY_COLUMNS])
            .where("id", "=", id).executeTakeFirst();
        return row ? policyRecord(row) : null;
    }
    async listPolicies() {
        const rows = await this.db.selectFrom("authz_policies")
            .select([...POLICY_COLUMNS])
            .orderBy("name", "asc").execute();
        const atts = await this.listGrants({ scopeKind: this.config.rootScope.kind });
        const byId = new Map();
        for (const a of atts) {
            const list = byId.get(a.policyId) ?? [];
            list.push(a.subject);
            byId.set(a.policyId, list);
        }
        return rows.map((r) => ({ ...policyRecord(r), attachments: byId.get(r.id) ?? [] }));
    }
    // A managed policy, copied into a normal editable one with the same
    // statements ("duplicate to customize"). Throws when the source doesn't
    // exist.
    async duplicatePolicy(id, name, createdBy) {
        const source = await this.getPolicy(id);
        if (!source)
            throw new Error("policy not found");
        return await this.createPolicy({
            name,
            description: source.description,
            statements: source.statements,
            createdBy,
        });
    }
    // Throws SystemPolicyError for a managed policy (immutable), or on a name
    // collision with a different policy (unique constraint).
    async updatePolicy(id, input) {
        const existing = await this.getPolicy(id);
        if (!existing)
            return null;
        if (existing.system) {
            throw new SystemPolicyError(`"${existing.name}" is a managed system policy`);
        }
        const row = await this.db.updateTable("authz_policies")
            .set({
            name: input.name,
            description: input.description,
            statements: JSON.stringify(input.statements),
            updated_at: sql `now()`,
        })
            .where("id", "=", id)
            .returning([...POLICY_COLUMNS])
            .executeTakeFirst();
        return row ? policyRecord(row) : null;
    }
    // Throws SystemPolicyError for a managed policy (immutable).
    async deletePolicy(id) {
        const existing = await this.getPolicy(id);
        if (!existing)
            return false;
        if (existing.system) {
            throw new SystemPolicyError(`"${existing.name}" is a managed system policy`);
        }
        await this.deleteGrantsForPolicy(id);
        const r = await this.db.deleteFrom("authz_policies").where("id", "=", id).executeTakeFirst();
        return Number(r.numDeletedRows) > 0;
    }
    // -------------------------------------------------------------------------
    // Audit (the AuditSink port)
    // -------------------------------------------------------------------------
    // Fire-and-forget: an audit outage must never break authorization, so
    // insert failures are swallowed with a console.warn and never propagate to
    // the request path. The first subject is recorded as the primary; no
    // subjects = anonymous.
    record(event) {
        const primary = event.subjects[0] ?? { kind: "anonymous", id: "anonymous" };
        const p = this.db.insertInto("authz_audit")
            .values({
            id: crypto.randomUUID(),
            subject_kind: primary.kind,
            subject_id: primary.id,
            action: event.action,
            resource: event.resource,
            decision: event.decision,
            source: event.source,
            detail: event.detail === null ? null : JSON.stringify(event.detail),
        })
            .execute()
            .then(() => {
            this.maybeSweep();
        })
            .catch((err) => {
            // Swallow: authorization must not depend on the audit log being
            // writable.
            console.warn("[authz] audit write failed:", err instanceof Error ? err.message : String(err));
        })
            .finally(() => {
            this.inflight.delete(p);
        });
        this.inflight.add(p);
    }
    // Drain in-flight fire-and-forget writes. For tests and shutdown only —
    // never on the request path.
    async flushAudit() {
        await Promise.all([...this.inflight]);
    }
    // Delete rows past the retention window. Returns the count removed. Run at
    // host boot and, probabilistically, on insert.
    async sweepAudit() {
        const r = await this.db.deleteFrom("authz_audit")
            .where("at", "<", sql `now() - make_interval(days => ${this.retentionDays})`)
            .executeTakeFirst();
        return Number(r.numDeletedRows ?? 0);
    }
    // ~2% of inserts trigger a sweep — cheap amortised retention, no scheduler.
    maybeSweep() {
        if (Math.random() < 0.02)
            void this.sweepAudit().catch(() => { });
    }
    // Reverse-chron page for an admin audit view. `subjectId`/`action` are
    // case-insensitive substring filters; `before` is the keyset cursor (the
    // last row's `at`) for load-more. limit is clamped 1..200.
    async listAudit(opts) {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        let q = this.db.selectFrom("authz_audit").selectAll();
        if (opts.subjectId)
            q = q.where("subject_id", "ilike", `%${opts.subjectId}%`);
        if (opts.action)
            q = q.where("action", "ilike", `%${opts.action}%`);
        if (opts.before)
            q = q.where("at", "<", opts.before);
        const rows = await q.orderBy("at", "desc").orderBy("id", "desc").limit(limit).execute();
        return rows.map((r) => ({
            id: r.id,
            at: iso(r.at),
            subject: { kind: r.subject_kind, id: r.subject_id },
            action: r.action,
            resource: r.resource,
            decision: r.decision,
            source: r.source,
            detail: r.detail,
        }));
    }
    // -------------------------------------------------------------------------
    grantQuery() {
        return this.db.selectFrom("authz_grants")
            .innerJoin("authz_policies", "authz_policies.id", "authz_grants.policy_id")
            .select([
            "authz_grants.id as id",
            "authz_grants.policy_id as policy_id",
            "authz_policies.name as policy_name",
            "authz_grants.subject_kind as subject_kind",
            "authz_grants.subject_id as subject_id",
            "authz_grants.scope_kind as scope_kind",
            "authz_grants.scope_id as scope_id",
            "authz_grants.bounds as bounds",
            "authz_grants.created_by as created_by",
            "authz_grants.created_at as created_at",
        ]);
    }
    grantRecord(row) {
        return {
            id: row.id,
            policyId: row.policy_id,
            policyName: row.policy_name,
            subject: { kind: row.subject_kind, id: row.subject_id },
            scope: { kind: row.scope_kind, id: row.scope_id },
            ...(row.bounds === null || row.bounds === undefined
                ? {}
                : { bounds: row.bounds }),
            createdBy: row.created_by,
            createdAt: iso(row.created_at),
        };
    }
}
//# sourceMappingURL=store.js.map