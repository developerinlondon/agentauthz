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
  isSetOperator,
  OPERATOR_KEY_TYPE,
  type PolicyCondition,
  SET_OPERATORS,
} from "./condition.js";
export {
  type AuthzDescriptor,
  type DescribedAction,
  type DescribedConditionKey,
  DESCRIPTOR_VERSION,
} from "./descriptor.js";
export { AuthzError } from "./errors.js";
export type { GrantBounds, GrantRecord, PolicyRecord, ResolvedGrant } from "./grant.js";
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
