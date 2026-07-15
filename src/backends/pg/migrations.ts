import { type Kysely, sql } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";
import type { PgAuthzConfig } from "./config.js";

// The reference schema, applied into the HOST's own database (never a
// separate authz DB): authz_policies (named statement bundles), authz_grants
// (a policy granted to a subject at a scope), authz_audit (per-decision log).
// The CHECK constraints are the AT-REST half of the fail-closed story: only
// declared scope kinds may be stored, the single root scope is always
// addressed by its canonical id, and a statement's `conditions` member — when
// present at all — is an array of objects. Semantic validity (operator/key
// whitelists, value parseability) is enforced at write time by
// validateStatements and re-checked fail-closed at eval time by
// evalConditions; the constraints stay shape-only on purpose so those
// whitelists can grow without a migration.

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function authzMigrations(config: PgAuthzConfig): Record<string, Migration> {
  const kinds = config.scopeKinds.map(sqlStringLiteral).join(", ");
  const rootKind = sqlStringLiteral(config.rootScope.kind);
  const rootId = sqlStringLiteral(config.rootScope.id);
  return {
    "0001_authz": {
      async up(db: Kysely<unknown>): Promise<void> {
        await db.schema.createTable("authz_policies").ifNotExists()
          .addColumn("id", "uuid", (c) => c.primaryKey())
          .addColumn("name", "text", (c) => c.notNull().unique())
          .addColumn("description", "text")
          .addColumn("statements", "jsonb", (c) => c.notNull())
          .addColumn("system", "boolean", (c) => c.notNull().defaultTo(false))
          .addColumn("created_by", "text")
          .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
          .execute();

        // A plain IMMUTABLE SQL function rather than a jsonpath expression:
        // lax-mode jsonpath auto-unwraps arrays inside filters, which makes
        // "is this member an array?" checks quietly wrong — exactly the kind
        // of subtlety an at-rest guard must not have.
        await sql`
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
        await sql`
          alter table authz_policies
          add constraint authz_policies_statement_conditions_shape_check
          check (authz_statement_conditions_ok(statements))
        `.execute(db);

        await db.schema.createTable("authz_grants").ifNotExists()
          .addColumn("id", "uuid", (c) => c.primaryKey())
          .addColumn("policy_id", "uuid", (c) => c.notNull())
          .addColumn("subject_kind", "text", (c) => c.notNull())
          .addColumn("subject_id", "text", (c) => c.notNull())
          .addColumn("scope_kind", "text", (c) => c.notNull())
          .addColumn("scope_id", "text", (c) => c.notNull())
          .addColumn("created_by", "text")
          .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
          .addUniqueConstraint("authz_grants_unique", [
            "policy_id",
            "subject_kind",
            "subject_id",
            "scope_kind",
            "scope_id",
          ])
          .execute();

        // Fail-closed shape: only declared scope kinds may be stored — an
        // unknown kind can never sit in the table waiting for a future
        // evaluator to misread it.
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
        // …and that id is reserved for the root ONLY, so a future writer
        // can't mint a deeper grant the scope-chain query would misfile as
        // root-wide. The invariant holds AT REST, not just in the write path.
        await sql.raw(`
          alter table authz_grants
          add constraint authz_grants_nonroot_scope_id_check
          check (scope_kind = ${rootKind} or scope_id <> ${rootId})
        `).execute(db);

        await db.schema.createIndex("authz_grants_scope")
          .ifNotExists().on("authz_grants").columns(["scope_kind", "scope_id"]).execute();
        await db.schema.createIndex("authz_grants_subject")
          .ifNotExists().on("authz_grants").columns(["subject_kind", "subject_id"]).execute();

        // Per-decision audit: "who could and who did". Written fire-and-forget
        // from inside the seam, never on the request's critical path.
        await db.schema.createTable("authz_audit").ifNotExists()
          .addColumn("id", "uuid", (c) => c.primaryKey())
          .addColumn("at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
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
      },
      async down(db: Kysely<unknown>): Promise<void> {
        await db.schema.dropTable("authz_audit").ifExists().execute();
        await db.schema.dropTable("authz_grants").ifExists().execute();
        await db.schema.dropTable("authz_policies").ifExists().execute();
        await sql`drop function if exists authz_statement_conditions_ok(jsonb)`.execute(db);
      },
    },
  };
}

// A ready-made provider for hosts that run these migrations standalone (a
// host with its own migration chain can fold authzMigrations into it instead).
export class AuthzMigrationProvider implements MigrationProvider {
  constructor(private readonly config: PgAuthzConfig) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    return authzMigrations(this.config);
  }
}
