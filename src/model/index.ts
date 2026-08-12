export {
  actionAncestry,
  type ActionCatalogueEntry,
  ActionCatalogueError,
  type ActionMatch,
  type ActionParentLookup,
  collectDescendants,
  indexActionCatalogue,
  matchAction,
  MAX_DERIVATION_DEPTH,
} from "./action.js";
export {
  CONDITION_OPERATORS,
  type ConditionContext,
  type ConditionKeys,
  type ConditionKeySpec,
  type ConditionKeyType,
  type ConditionOperator,
  OPERATOR_KEY_TYPE,
  type PolicyCondition,
} from "./condition.js";
export type { GrantRecord, PolicyRecord, ResolvedGrant } from "./grant.js";
export { isValidScope, type Scope, type ScopeChain, scopeEquals } from "./scope.js";
export {
  actionMatches,
  type Effect,
  isValidAction,
  isValidResource,
  type PolicyStatement,
  resourceMatches,
} from "./statement.js";
export { isValidSubject, type Subject, subjectEquals } from "./subject.js";
