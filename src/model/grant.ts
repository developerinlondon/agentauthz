import type { PolicyCondition } from "./condition.js";
import type { Scope } from "./scope.js";
import type { PolicyStatement } from "./statement.js";
import type { Subject } from "./subject.js";

// A grant is a policy given to a subject AT A SCOPE in the host's hierarchy.
// Evaluation resolves the scope CHAIN for a check and unions every applicable
// grant's statements; a deny granted at ANY scope in the chain beats an allow
// from any other.

export interface PolicyRecord {
  id: string;
  name: string;
  description: string | null;
  statements: PolicyStatement[];
  // A curated, immutable managed policy: rejected by update/delete, but
  // attachable and duplicate-to-customize stays open.
  system: boolean;
  updatedAt: string;
}

// Conditions carried by the GRANT, so one curated policy is attachable with
// different limits per subject. They narrow ALLOW statements only: ANDing a
// bound onto a deny would make it fire less often — widening access.
export type GrantBounds = PolicyCondition[];

export interface GrantRecord {
  id: string;
  policyId: string;
  policyName: string;
  subject: Subject;
  scope: Scope;
  bounds?: GrantBounds;
  createdBy: string | null;
  createdAt: string;
}

// A grant folded into evaluation: the policy's statements plus WHO it was
// granted to (the "why" for a listing) and WHERE in the hierarchy it applies.
export interface ResolvedGrant {
  policyId: string;
  policyName: string;
  subject: Subject;
  scope: Scope;
  statements: PolicyStatement[];
  bounds?: GrantBounds;
}
