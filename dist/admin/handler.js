// Admin routes as plain (Request) => Response over Web-standard types, so the
// same handlers run under Bun, Node, Deno and Workers unchanged.
//
// THEY NEVER DECIDE WHO MAY ADMINISTER. That is the host's, and mounting them
// unauthenticated exposes grant creation to anyone who can reach the path.
import { validateConditions } from "../core/conditions.js";
import { resolveConditionKeys } from "../core/conditions.js";
import { isValidScope } from "../model/scope.js";
import { isValidSubject } from "../model/subject.js";
function auditWrite(opts, actor, action, resource, detail) {
    opts.auditSink?.record({
        subjects: actor ? [actor] : [],
        action,
        resource,
        decision: "executed",
        source: "authz-admin",
        detail,
    });
}
function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}
const fail = (error, status) => json({ error }, status);
// The descriptor already carries each key's type and lowercase flag, which is
// exactly ConditionKeys — so validation uses the same vocabulary the UI was
// told about, and the two cannot disagree about what is legal.
function conditionKeysOf(descriptor) {
    const keys = {};
    for (const [key, spec] of Object.entries(descriptor.conditionKeys)) {
        keys[key] = { type: spec.type, ...(spec.lowercase ? { lowercase: true } : {}) };
    }
    return resolveConditionKeys(keys);
}
function parseBounds(raw, keys) {
    if (raw === undefined || raw === null)
        return { ok: true, value: [] };
    if (!Array.isArray(raw))
        return { ok: false, response: fail("bounds must be an array", 400) };
    if (raw.length === 0)
        return { ok: true, value: [] };
    const v = validateConditions(raw, keys);
    // The message is validateConditions' own, verbatim, so a UI surfaces the
    // same text the engine would have produced at check time.
    if (!v.ok)
        return { ok: false, response: fail(v.error, 400) };
    return { ok: true, value: v.conditions };
}
async function createGrant(request, opts, keys) {
    let body;
    try {
        body = await request.json();
    }
    catch {
        return fail("body must be JSON", 400);
    }
    if (typeof body.policyId !== "string" || body.policyId.length === 0) {
        return fail("policyId is required", 400);
    }
    if (!isValidSubject(body.subject))
        return fail("subject must be {kind, id}", 400);
    if (!isValidScope(body.scope))
        return fail("scope must be {kind, id}", 400);
    const kinds = opts.descriptor.scopeKinds;
    if (kinds.length > 0 && !kinds.includes(body.scope.kind)) {
        return fail(`scope kind "${body.scope.kind}" is not declared`, 400);
    }
    const bounds = parseBounds(body.bounds, keys);
    if (!bounds.ok)
        return bounds.response;
    const list = bounds.value;
    const actor = opts.actor?.(request) ?? null;
    await opts.store.createGrant({
        policyId: body.policyId,
        subject: body.subject,
        scope: body.scope,
        ...(list.length > 0 ? { bounds: list } : {}),
        createdBy: actor?.id ?? null,
    });
    auditWrite(opts, actor, "authz.grant.create", `policy:${body.policyId}`, {
        subject: body.subject,
        scope: body.scope,
        ...(list.length > 0 ? { bounds: list } : {}),
    });
    return json({ ok: true }, 201);
}
function numberParam(params, name) {
    const raw = params.get(name);
    if (raw === null)
        return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}
function optional(params, name) {
    return params.get(name) ?? undefined;
}
async function readRoute(path, params, opts) {
    if (path === "/descriptor")
        return json(opts.descriptor);
    if (path === "/policies")
        return json(await opts.store.listPolicies());
    if (path === "/grants") {
        return json(await opts.store.listGrants({
            scopeKind: optional(params, "scopeKind"),
            scopeId: optional(params, "scopeId"),
            policyId: optional(params, "policyId"),
            subjectKind: optional(params, "subjectKind"),
            subjectId: optional(params, "subjectId"),
        }));
    }
    if (path === "/audit") {
        return json(await opts.store.listAudit({
            subjectId: optional(params, "subjectId"),
            action: optional(params, "action"),
            before: optional(params, "before"),
            limit: numberParam(params, "limit"),
        }));
    }
    if (path === "/subjects") {
        if (!opts.subjects)
            return fail("this host does not expose a subject directory", 501);
        return json(await opts.subjects.list({
            q: optional(params, "q"),
            kind: optional(params, "kind"),
            limit: numberParam(params, "limit"),
        }));
    }
    return null;
}
export function createAdminHandler(opts) {
    const base = (opts.basePath ?? "").replace(/\/$/, "");
    const keys = conditionKeysOf(opts.descriptor);
    return async (request) => {
        const url = new URL(request.url);
        if (base && !url.pathname.startsWith(base))
            return fail("not found", 404);
        const path = url.pathname.slice(base.length) || "/";
        if (request.method === "GET") {
            const response = await readRoute(path, url.searchParams, opts);
            return response ?? fail("not found", 404);
        }
        if (request.method === "POST" && path === "/grants") {
            return await createGrant(request, opts, keys);
        }
        if (request.method === "DELETE" && path.startsWith("/grants/")) {
            const id = decodeURIComponent(path.slice("/grants/".length));
            if (!id)
                return fail("grant id is required", 400);
            if (!await opts.store.deleteGrant(id))
                return fail("not found", 404);
            auditWrite(opts, opts.actor?.(request) ?? null, "authz.grant.revoke", `grant:${id}`, {});
            return json({ ok: true });
        }
        return fail("not found", 404);
    };
}
//# sourceMappingURL=handler.js.map