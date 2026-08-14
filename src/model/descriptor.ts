// The vocabulary as DATA — the contract an administration UI consumes, so one
// UI can administer any host that serves this shape. See
// designs/administration-surface.md.

import type { ConditionKeyType, ConditionOperator } from "./condition.js";

// Bumped only when an old consumer would render a WRONG form from a new
// document — never for a purely additive field.
export const DESCRIPTOR_VERSION = 1;

export interface DescribedAction {
  action: string;
  derivesFrom?: string;
  title?: string;
  description?: string;
}

export interface DescribedConditionKey {
  type: ConditionKeyType;
  lowercase?: true;
  builtIn?: true;
  // Derived from `type` via OPERATOR_KEY_TYPE, never authored: a UI that
  // duplicated that table would drift from it.
  operators: ConditionOperator[];
  title?: string;
  description?: string;
}

export interface AuthzDescriptor {
  version: typeof DESCRIPTOR_VERSION;
  // Declaration order, not sorted — a host's ordering groups related actions.
  actions: DescribedAction[];
  // Precomputed transitive derivation; empty when none is declared.
  actionClosures: Record<string, string[]>;
  conditionKeys: Record<string, DescribedConditionKey>;
  scopeKinds: string[];
  setOperators: ConditionOperator[];
}
