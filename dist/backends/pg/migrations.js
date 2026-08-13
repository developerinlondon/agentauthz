import { sql } from "kysely";
// The reference schema, applied into the HOST's own database (never a
// separate authz DB): authz_policies (named statement bundles), authz_grants
// (a policy granted to a subject at a scope), authz_audit (per-decision log).
// The CHECK constraints are the AT-REST half of the fail-closed story, and
// stay SHAPE-only on purpose: semantic validity (operator/key whitelists,
// value parseability) is enforced at write time by validateStatements and
// re-checked at eval time, so those whitelists grow without a migration.
function sqlStringLiteral(value) {
    return `'${value.replaceAll("'", "''")}'`;
}
async function createPolicies(db) {
    await db.schema.createTable("authz_policies").ifNotExists()
        .addColumn("id", "uuid", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull().unique())
        .addColumn("description", "text")
        .addColumn("statements", "jsonb", (c) => c.notNull())
        .addColumn("system", "boolean", (c) => c.notNull().defaultTo(false))
        .addColumn("created_by", "text")
        .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql `now()`))
        .execute();
    // A plain IMMUTABLE SQL function rather than a jsonpath expression:
    // lax-mode jsonpath auto-unwraps arrays inside filters, which makes
    // "is this member an array?" checks quietly wrong.
    await sql `
    create function authz_statement_conditions_ok(stmts jsonb) returns boolean
    language sql immutable as $$
      select coalesce(bool_and(
        s.value -> 'conditions' is null
        or (
          jsonb_typeof(s.value -> 'conditions') = 'array'
          and not exists (
            select 1 from jsonb_array_elements(s.value -> 'conditions') c
            where jsonb_typeof(c.value) <> 'object'
          )
        )
      ), true)
      from jsonb_array_elements(stmts) s
    $$
  `.execute(db);
    await sql `
    alter table authz_policies
    add constraint authz_policies_statement_conditions_shape_check
    check (authz_statement_conditions_ok(statements))
  `.execute(db);
}
async function createGrants(db, config) {
    const kinds = config.scopeKinds.map(sqlStringLiteral).join(", ");
    const rootKind = sqlStringLiteral(config.rootScope.kind);
    const rootId = sqlStringLiteral(config.rootScope.id);
    await db.schema.createTable("authz_grants").ifNotExists()
        .addColumn("id", "uuid", (c) => c.primaryKey())
        .addColumn("policy_id", "uuid", (c) => c.notNull())
        .addColumn("subject_kind", "text", (c) => c.notNull())
        .addColumn("subject_id", "text", (c) => c.notNull())
        .addColumn("scope_kind", "text", (c) => c.notNull())
        .addColumn("scope_id", "text", (c) => c.notNull())
        .addColumn("created_by", "text")
        .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql `now()`))
        .addUniqueConstraint("authz_grants_unique", [
        "policy_id",
        "subject_kind",
        "subject_id",
        "scope_kind",
        "scope_id",
    ])
        .execute();
    // Only declared scope kinds may be stored — an unknown kind can never sit
    // in the table waiting for a future evaluator to misread it.
    await sql.raw(`
    alter table authz_grants
    add constraint authz_grants_scope_kind_check
    check (scope_kind in (${kinds}))
  `).execute(db);
    // The single root is always addressed by its canonical id…
    await sql.raw(`
    alter table authz_grants
    add constraint authz_grants_root_scope_id_check
    check (scope_kind <> ${rootKind} or scope_id = ${rootId})
  `).execute(db);
    // …and that id is reserved for the root ONLY, so a future writer can't mint
    // a deeper grant the scope-chain query would misfile as root-wide.
    await sql.raw(`
    alter table authz_grants
    add constraint authz_grants_nonroot_scope_id_check
    check (scope_kind = ${rootKind} or scope_id <> ${rootId})
  `).execute(db);
    await db.schema.createIndex("authz_grants_scope")
        .ifNotExists().on("authz_grants").columns(["scope_kind", "scope_id"]).execute();
    await db.schema.createIndex("authz_grants_subject")
        .ifNotExists().on("authz_grants").columns(["subject_kind", "subject_id"]).execute();
}
async function createAudit(db) {
    await db.schema.createTable("authz_audit").ifNotExists()
        .addColumn("id", "uuid", (c) => c.primaryKey())
        .addColumn("at", "timestamptz", (c) => c.notNull().defaultTo(sql `now()`))
        .addColumn("subject_kind", "text", (c) => c.notNull())
        .addColumn("subject_id", "text", (c) => c.notNull())
        .addColumn("action", "text", (c) => c.notNull())
        .addColumn("resource", "text", (c) => c.notNull())
        .addColumn("decision", "text", (c) => c.notNull())
        .addColumn("source", "text", (c) => c.notNull())
        .addColumn("detail", "jsonb")
        .execute();
    await db.schema.createIndex("authz_audit_at")
        .ifNotExists().on("authz_audit").column("at desc").execute();
    await db.schema.createIndex("authz_audit_subject_at")
        .ifNotExists().on("authz_audit").columns(["subject_kind", "subject_id", "at desc"])
        .execute();
}
function baseSchema(config) {
    return {
        async up(db) {
            await createPolicies(db);
            await createGrants(db, config);
            await createAudit(db);
        },
        async down(db) {
            await db.schema.dropTable("authz_audit").ifExists().execute();
            await db.schema.dropTable("authz_grants").ifExists().execute();
            await db.schema.dropTable("authz_policies").ifExists().execute();
            await sql `drop function if exists authz_statement_conditions_ok(jsonb)`.execute(db);
        },
    };
}
// Bounds narrow a grant, so they live beside it rather than in the policy.
function grantBounds() {
    return {
        // Idempotent throughout: a host folding this into its own chain runs it
        // from a squashed baseline on fresh databases AND as a delta on live ones,
        // and those two paths must converge rather than collide.
        async up(db) {
            await sql `alter table authz_grants add column if not exists bounds jsonb`.execute(db);
            await sql `
        create or replace function authz_bounds_ok(bounds jsonb) returns boolean
        language sql immutable as $$
          select bounds is null or (
            jsonb_typeof(bounds) = 'array'
            and not exists (
              select 1 from jsonb_array_elements(bounds) b
              where jsonb_typeof(b.value) <> 'object'
            )
          )
        $$
      `.execute(db);
            await sql `
        do $$
        begin
          alter table authz_grants
            add constraint authz_grants_bounds_shape_check check (authz_bounds_ok(bounds));
        exception when duplicate_object then null;
        end $$
      `.execute(db);
        },
        async down(db) {
            await sql `
        alter table authz_grants drop constraint if exists authz_grants_bounds_shape_check
      `.execute(db);
            await db.schema.alterTable("authz_grants").dropColumn("bounds").execute();
            await sql `drop function if exists authz_bounds_ok(jsonb)`.execute(db);
        },
    };
}
export function authzMigrations(config) {
    return {
        "0001_authz": baseSchema(config),
        "0002_grant_bounds": grantBounds(),
    };
}
// Hosts folding these into their own chain must use this rather than naming
// one key: hardcoding "0001_authz" silently skips everything added later.
export async function applyAuthzMigrations(db, config) {
    const all = authzMigrations(config);
    for (const key of Object.keys(all).sort())
        await all[key].up(db);
}
// The mirror image, newest first, so a host's rollback leaves nothing behind.
export async function revertAuthzMigrations(db, config) {
    const all = authzMigrations(config);
    for (const key of Object.keys(all).sort().reverse())
        await all[key].down?.(db);
}
// For hosts that run these standalone rather than folding them into a chain.
export class AuthzMigrationProvider {
    config;
    constructor(config) {
        this.config = config;
    }
    async getMigrations() {
        return authzMigrations(this.config);
    }
}
//# sourceMappingURL=migrations.js.map