import type { Scope } from "../../model/scope.js";

export interface PgAuthzConfig {
  // Every scope kind the host's hierarchy declares, root included. Stored
  // grants are CHECK-constrained to these.
  scopeKinds: readonly string[];
  // The hierarchy's single root scope. Grants at the root kind are always
  // stored with this canonical id (createGrant normalizes), and the id is
  // reserved for the root only.
  rootScope: Scope;
  // Audit rows older than this are swept on insert (cheap random check) and
  // via sweepAudit(). The audit log is a bounded operational record, not
  // archival.
  auditRetentionDays?: number;
}
