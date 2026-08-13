import type { Scope } from "../../model/scope.js";
export interface PgAuthzConfig {
  scopeKinds: readonly string[];
  rootScope: Scope;
  auditRetentionDays?: number;
}
// # sourceMappingURL=config.d.ts.map
