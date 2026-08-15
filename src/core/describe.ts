import {
  CONDITION_OPERATORS,
  type ConditionKeys,
  type ConditionKeyType,
  type ConditionOperator,
  OPERATOR_KEY_TYPE,
  SET_OPERATORS,
} from "../model/condition.js";
import {
  type AuthzDescriptor,
  type DescribedAction,
  type DescribedConditionKey,
  DESCRIPTOR_VERSION,
} from "../model/descriptor.js";
import type { ActionRegistry } from "../ports/index.js";
import { BUILTIN_CONDITION_KEYS, resolveConditionKeys } from "./conditions.js";

export interface DescribeInput {
  actionRegistry?: ActionRegistry;
  conditionKeys?: ConditionKeys;
  scopeKinds?: readonly string[];
}

function operatorsFor(type: ConditionKeyType): ConditionOperator[] {
  return CONDITION_OPERATORS.filter((op) => OPERATOR_KEY_TYPE[op] === type);
}

// A projection of the declared vocabulary, holding no state of its own. A
// registry that cannot enumerate its actions degrades to an empty catalogue
// rather than throwing: grants and audit remain administrable without one.
export function describeAuthz(input: DescribeInput = {}): AuthzDescriptor {
  const registry = input.actionRegistry;
  const names = registry?.listActions?.() ?? [];

  const actions: DescribedAction[] = names.map((action) => {
    const parent = registry?.parentOf?.(action);
    const notes = registry?.annotationsOf?.(action);
    return {
      action,
      ...(parent === undefined ? {} : { derivesFrom: parent }),
      ...(notes?.title === undefined ? {} : { title: notes.title }),
      ...(notes?.description === undefined ? {} : { description: notes.description }),
    };
  });

  const actionClosures: Record<string, string[]> = {};
  const descendantsOf = registry?.descendantsOf;
  if (descendantsOf) {
    for (const action of names) actionClosures[action] = descendantsOf.call(registry, action);
  }

  const conditionKeys: Record<string, DescribedConditionKey> = {};
  for (const [key, spec] of Object.entries(resolveConditionKeys(input.conditionKeys))) {
    conditionKeys[key] = {
      type: spec.type,
      ...(spec.lowercase === true ? { lowercase: true as const } : {}),
      ...(Object.hasOwn(BUILTIN_CONDITION_KEYS, key) ? { builtIn: true as const } : {}),
      operators: operatorsFor(spec.type),
      ...(spec.title === undefined ? {} : { title: spec.title }),
      ...(spec.description === undefined ? {} : { description: spec.description }),
    };
  }

  return {
    version: DESCRIPTOR_VERSION,
    actions,
    actionClosures,
    conditionKeys,
    scopeKinds: [...(input.scopeKinds ?? [])],
    setOperators: [...SET_OPERATORS],
  };
}

// The projection back: a descriptor already carries each key's type and
// lowercase flag, which is exactly ConditionKeys. An administrative surface
// validating a bound therefore uses the same vocabulary its consumer was told
// about, and the two cannot disagree about what is legal.
export function conditionKeysFromDescriptor(descriptor: AuthzDescriptor): ConditionKeys {
  const keys: ConditionKeys = {};
  for (const [key, spec] of Object.entries(descriptor.conditionKeys)) {
    keys[key] = { type: spec.type, ...(spec.lowercase ? { lowercase: true } : {}) };
  }
  return resolveConditionKeys(keys);
}
