// The backend flip contract: every engine semantic as data-driven golden
// fixtures. The JSON files under ./cases are language-neutral — an
// alternative backend (another store, another language) must produce the same
// decision for every case before an app flips config to it. The runner here
// executes them against this library's pure evaluator and against a composed
// engine over any GrantStore.

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { makeAuthz } from "../core/authz.js";
import { builtinContextEntries, makeConditionContext } from "../core/conditions.js";
import { resolveConditionKeys } from "../core/conditions.js";
import { evaluate } from "../core/evaluate.js";
import type { ActionCatalogueEntry } from "../model/action.js";
import type { ConditionKeys } from "../model/condition.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { ResolvedGrant } from "../model/grant.js";
import type { Scope } from "../model/scope.js";
import type { Subject } from "../model/subject.js";
import { memoryGrantSource } from "./memory.js";

export { memoryGrantSource, MemoryGrantStore } from "./memory.js";

export interface DescriptorFixture {
  vocabulary: {
    actions: ActionCatalogueEntry[];
    conditionKeys: ConditionKeys;
    scopeKinds: string[];
  };
  expected: AuthzDescriptor;
}

// The descriptor contract as data: a known vocabulary and the exact document
// it must produce, so a change to the shape is a deliberate act rather than a
// surprise for every UI downstream.
export function loadDescriptorFixture(): DescriptorFixture {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "descriptor");
  const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  return { vocabulary: read("vocabulary.json"), expected: read("expected.json") };
}

export interface ConformanceCase {
  suite: string;
  name: string;
  conditionKeys: ConditionKeys;
  scopeKinds: string[];
  grants: ResolvedGrant[];
  // Grants a ScopeRoleSynthesizer contributes (e.g. app-owned membership
  // roles) — unioned with `grants` by every conforming engine, confined by
  // the same subject/scope matching.
  synthesizedGrants: ResolvedGrant[];
  check: {
    subjects: Subject[];
    action: string;
    resource: string;
    // Deliberately loose-shaped: fixtures include malformed entries that a
    // conforming engine must fail closed on.
    scopeChain: Scope[];
    context: Record<string, string | number | string[]>;
    sourceIp?: string;
    now?: string;
  };
  // Declared action derivation for the case, child -> parent. A statement
  // naming a parent covers every action deriving from it, allow and deny alike.
  actionDerivation: Record<string, string>;
  expect: "allow" | "deny";
  // false ⇒ this case's grants carry a conditions SHAPE a shape-checking
  // store must refuse at rest (the library's pg backend CHECK-constrains
  // statements). Engines still evaluate it fail-closed from a raw grant list;
  // a storage-backed runner should instead assert the write is rejected.
  storable: boolean;
}

interface SuiteFile {
  suite: string;
  conditionKeys?: ConditionKeys;
  scopeKinds?: string[];
  actionDerivation?: Record<string, string>;
  cases: Array<
    Omit<
      ConformanceCase,
      | "suite"
      | "conditionKeys"
      | "scopeKinds"
      | "grants"
      | "synthesizedGrants"
      | "storable"
      | "actionDerivation"
    > & {
      conditionKeys?: ConditionKeys;
      scopeKinds?: string[];
      actionDerivation?: Record<string, string>;
      storable?: boolean;
      grants?: Array<Partial<ResolvedGrant> & Pick<ResolvedGrant, "subject" | "scope">>;
      synthesizedGrants?: Array<Partial<ResolvedGrant> & Pick<ResolvedGrant, "subject" | "scope">>;
    }
  >;
}

function normalizeGrants(
  grants: SuiteFile["cases"][number]["grants"],
  prefix: string,
): ResolvedGrant[] {
  return (grants ?? []).map((g, i) => ({
    policyId: g.policyId ?? `${prefix}${i + 1}`,
    policyName: g.policyName ?? `${prefix}${i + 1}`,
    subject: g.subject,
    scope: g.scope,
    statements: g.statements ?? [],
    ...(g.bounds !== undefined ? { bounds: g.bounds } : {}),
  }));
}

// Every case from every suite file under ./cases, suite defaults folded in.
export function loadConformanceCases(): ConformanceCase[] {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases");
  const out: ConformanceCase[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const suite = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as SuiteFile;
    for (const c of suite.cases) {
      out.push({
        suite: suite.suite,
        name: c.name,
        conditionKeys: c.conditionKeys ?? suite.conditionKeys ?? {},
        scopeKinds: c.scopeKinds ?? suite.scopeKinds ?? [],
        grants: normalizeGrants(c.grants, "p"),
        synthesizedGrants: normalizeGrants(c.synthesizedGrants, "synth-p"),
        actionDerivation: c.actionDerivation ?? suite.actionDerivation ?? {},
        check: c.check,
        expect: c.expect,
        storable: c.storable ?? true,
      });
    }
  }
  return out;
}

// undefined when a case declares no derivation, so those cases exercise the
// exact-equality path rather than a lookup that always misses.
function caseParentLookup(c: ConformanceCase): ((a: string) => string | undefined) | undefined {
  const map = c.actionDerivation;
  if (!map || Object.keys(map).length === 0) return undefined;
  return (action) => map[action];
}

export type ConformanceImpl = (c: ConformanceCase) => Promise<"allow" | "deny">;

// Reference 1: the pure evaluator over the raw grant universe.
export const pureEvaluatorImpl: ConformanceImpl = async (c) => {
  const now = c.check.now ? new Date(c.check.now) : undefined;
  return evaluate({
    grants: [...c.grants, ...c.synthesizedGrants],
    subjects: c.check.subjects,
    action: c.check.action,
    resource: c.check.resource,
    scopeChain: c.check.scopeChain,
    context: makeConditionContext({
      ...c.check.context,
      ...builtinContextEntries({ now, sourceIp: c.check.sourceIp }),
    }),
    conditionKeys: resolveConditionKeys(c.conditionKeys),
    scopeKinds: c.scopeKinds,
    actionParentOf: caseParentLookup(c),
  });
};

// Reference 2: the composed engine (ports wiring) over an in-memory store —
// the template for running the fixtures against a real backend: swap the
// grant source for yours and the decisions must not change.
export const composedEngineImpl: ConformanceImpl = async (c) => {
  const authz = makeAuthz({
    grantStore: {
      grantsFor: memoryGrantSource(c.grants).grantsFor,
      createGrant: () => Promise.reject(new Error("read-only")),
      deleteGrant: () => Promise.reject(new Error("read-only")),
      deleteGrantsForSubject: () => Promise.reject(new Error("read-only")),
      deleteGrantsForPolicy: () => Promise.reject(new Error("read-only")),
    },
    synthesizers: c.synthesizedGrants.length > 0
      ? [memoryGrantSource(c.synthesizedGrants)]
      : [],
    conditionKeys: c.conditionKeys,
    scopeKinds: c.scopeKinds,
    actionRegistry: {
      isKnownAction: () => true,
      parentOf: caseParentLookup(c),
    },
  });
  const allowed = await authz.check(c.check.subjects, c.check.action, c.check.resource, {
    scopeChain: c.check.scopeChain,
    context: c.check.context,
    sourceIp: c.check.sourceIp,
    now: c.check.now ? new Date(c.check.now) : undefined,
    silent: true,
  });
  return allowed ? "allow" : "deny";
};

export interface ConformanceResult {
  case: ConformanceCase;
  expected: "allow" | "deny";
  actual: "allow" | "deny";
  pass: boolean;
}

export async function runConformance(impl: ConformanceImpl): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const c of loadConformanceCases()) {
    const actual = await impl(c);
    results.push({ case: c, expected: c.expect, actual, pass: actual === c.expect });
  }
  return results;
}
