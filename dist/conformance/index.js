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
import { memoryGrantSource } from "./memory.js";
export { memoryGrantSource, MemoryGrantStore } from "./memory.js";
function normalizeGrants(grants, prefix) {
    return (grants ?? []).map((g, i) => ({
        policyId: g.policyId ?? `${prefix}${i + 1}`,
        policyName: g.policyName ?? `${prefix}${i + 1}`,
        subject: g.subject,
        scope: g.scope,
        statements: g.statements ?? [],
    }));
}
// Every case from every suite file under ./cases, suite defaults folded in.
export function loadConformanceCases() {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases");
    const out = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
        const suite = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
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
function caseParentLookup(c) {
    const map = c.actionDerivation;
    if (!map || Object.keys(map).length === 0)
        return undefined;
    return (action) => map[action];
}
// Reference 1: the pure evaluator over the raw grant universe.
export const pureEvaluatorImpl = async (c) => {
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
export const composedEngineImpl = async (c) => {
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
export async function runConformance(impl) {
    const results = [];
    for (const c of loadConformanceCases()) {
        const actual = await impl(c);
        results.push({ case: c, expected: c.expect, actual, pass: actual === c.expect });
    }
    return results;
}
//# sourceMappingURL=index.js.map