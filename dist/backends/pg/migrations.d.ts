import type { Migration, MigrationProvider } from "kysely/migration";
import type { PgAuthzConfig } from "./config.js";
export declare function authzMigrations(config: PgAuthzConfig): Record<string, Migration>;
export declare class AuthzMigrationProvider implements MigrationProvider {
    private readonly config;
    constructor(config: PgAuthzConfig);
    getMigrations(): Promise<Record<string, Migration>>;
}
//# sourceMappingURL=migrations.d.ts.map