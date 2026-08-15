// The six tools of the agent-facing surface, plus a grants listing so a
// revoke has something to name. Each is a thin adapter over the same ports the
// admin handlers use — no tool decides anything the engine would not.
//
// THEY NEVER DECIDE WHO MAY ADMINISTER. A host that hands an agent this server
// has handed it grant creation; gating that is the host's, at the transport.
import { normalizeBounds, recordAdminWrite } from "../admin/writes.js";
import { conditionKeysFromDescriptor } from "../core/describe.js";
import { optionalContext, optionalNumber, optionalScopeChain, optionalString, requiredScope, requiredString, requiredSubject, requiredSubjects, toolArgs, } from "./args.js";
import { actionSchema, boundsSchema, contextSchema, scopeSchema, SUBJECT_SCHEMA, } from "./schema.js";
// The door these writes came through, as the audit row's source — the admin
// HTTP surface records "authz-admin", so a host can tell an agent's grant from
// an operator's without reading anything else.
const AUDIT_SOURCE = "authz-mcp";
export function toolContext(options) {
    const descriptor = options.descriptor ?? options.authz.describe();
    return { options, descriptor, keys: conditionKeysFromDescriptor(descriptor) };
}
function object(properties, required = []) {
    return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: false,
    };
}
const NO_ARGS = object({});
const STRING = { type: "string" };
async function check(args, ctx) {
    const opts = { source: AUDIT_SOURCE };
    const scopeChain = optionalScopeChain(args, "scopeChain");
    if (scopeChain !== undefined)
        opts.scopeChain = scopeChain;
    const context = optionalContext(args, "context");
    if (context !== undefined)
        opts.context = context;
    const sourceIp = optionalString(args, "sourceIp");
    if (sourceIp !== undefined)
        opts.sourceIp = sourceIp;
    return await ctx.options.authz.checkDetailed(requiredSubjects(args, "subjects"), requiredString(args, "action"), requiredString(args, "resource"), opts);
}
async function grant(args, ctx) {
    const policyId = requiredString(args, "policyId");
    const subject = requiredSubject(args, "subject");
    const scope = requiredScope(args, "scope");
    const kinds = ctx.descriptor.scopeKinds;
    if (kinds.length > 0 && !kinds.includes(scope.kind)) {
        throw new Error(`scope kind "${scope.kind}" is not declared`);
    }
    const bounds = normalizeBounds(args.bounds, ctx.keys);
    if (!bounds.ok)
        throw new Error(bounds.error);
    const actor = ctx.options.actor ?? null;
    const carried = bounds.bounds.length > 0 ? { bounds: bounds.bounds } : {};
    await ctx.options.store.createGrant({
        policyId,
        subject,
        scope,
        ...carried,
        createdBy: actor?.id ?? null,
    });
    recordAdminWrite(ctx.options.auditSink, actor, "authz.grant.create", `policy:${policyId}`, { subject, scope, ...carried }, AUDIT_SOURCE);
    return { ok: true, policyId, subject, scope, ...carried };
}
async function revoke(args, ctx) {
    const grantId = requiredString(args, "grantId");
    if (!await ctx.options.store.deleteGrant(grantId)) {
        throw new Error(`grant "${grantId}" not found`);
    }
    recordAdminWrite(ctx.options.auditSink, ctx.options.actor ?? null, "authz.grant.revoke", `grant:${grantId}`, {}, AUDIT_SOURCE);
    return { ok: true, grantId };
}
const DEFINITIONS = {
    authz_check: {
        title: "Check a permission",
        description: "May these subjects perform this action on this resource? Deny wins across the whole "
            + "scope chain; nothing granted denies. Reports whether the stored grants alone allow it, "
            + "so an allow that rests only on an ambient default is visible as such.",
        schema: (d) => {
            const context = contextSchema(d);
            return object({
                subjects: { type: "array", minItems: 1, items: SUBJECT_SCHEMA },
                action: actionSchema(d),
                resource: { type: "string", minLength: 1 },
                scopeChain: {
                    type: "array",
                    items: scopeSchema(d),
                    description: "Root first. Omitted uses the engine's default chain; an undeclared or "
                        + "malformed entry denies.",
                },
                ...(context === undefined ? {} : { context }),
                sourceIp: {
                    type: "string",
                    description: "The caller's address, for the built-in request:SourceIp key. Omit it and "
                        + "any condition on that key fails closed.",
                },
            }, ["subjects", "action", "resource"]);
        },
        handle: check,
    },
    authz_grant: {
        title: "Grant a policy at a scope",
        description: "Attach a policy to a subject at a scope, optionally bounded. Bounds narrow the policy's "
            + "allow statements for this subject only — one curated policy, different limits per "
            + "subject. A rejected bound reports the engine's own message; correct it and retry.",
        schema: (d) => object({
            policyId: { type: "string", minLength: 1 },
            subject: SUBJECT_SCHEMA,
            scope: scopeSchema(d),
            bounds: boundsSchema(d),
        }, ["policyId", "subject", "scope"]),
        handle: grant,
    },
    authz_revoke: {
        title: "Revoke a grant",
        description: "Delete one grant by id. Find the id with authz_grants.",
        schema: () => object({ grantId: { type: "string", minLength: 1 } }, ["grantId"]),
        handle: revoke,
    },
    authz_grants: {
        title: "List grants",
        description: "Grants matching the given filters, each with its id — what a subject holds, and "
            + "what authz_revoke names.",
        schema: () => object({
            policyId: STRING,
            subjectKind: STRING,
            subjectId: STRING,
            scopeKind: STRING,
            scopeId: STRING,
        }),
        handle: async (args, ctx) => await ctx.options.store.listGrants({
            ...pick(args, "policyId", "subjectKind", "subjectId", "scopeKind", "scopeId"),
        }),
    },
    authz_policies: {
        title: "List policies",
        description: "Every attachable policy with its statements — what authz_grant may attach.",
        schema: () => NO_ARGS,
        handle: async (_args, ctx) => await ctx.options.store.listPolicies(),
    },
    authz_audit_query: {
        title: "Query the audit trail",
        description: "Recorded decisions and administrative writes, newest first.",
        schema: () => object({
            subjectId: STRING,
            action: STRING,
            before: { type: "string", description: "Return rows older than this timestamp." },
            limit: { type: "number" },
        }),
        handle: async (args, ctx) => {
            const limit = optionalNumber(args, "limit");
            return await ctx.options.store.listAudit({
                ...pick(args, "subjectId", "action", "before"),
                ...(limit === undefined ? {} : { limit }),
            });
        },
    },
    authz_describe: {
        title: "Describe the vocabulary",
        description: "This host's declared actions, action derivation, condition keys and scope kinds, as data. "
            + "The same declarations these tools' input schemas are generated from.",
        schema: () => NO_ARGS,
        handle: async (_args, ctx) => ctx.descriptor,
    },
};
function pick(args, ...names) {
    const out = {};
    for (const name of names) {
        const value = optionalString(args, name);
        if (value !== undefined)
            out[name] = value;
    }
    return out;
}
export function listTools(ctx) {
    return Object.entries(DEFINITIONS).map(([name, def]) => ({
        name,
        title: def.title,
        description: def.description,
        inputSchema: def.schema(ctx.descriptor),
    }));
}
export function isKnownTool(name) {
    return Object.hasOwn(DEFINITIONS, name);
}
export async function runTool(name, args, ctx) {
    const def = DEFINITIONS[name];
    if (!def)
        throw new Error(`Unknown tool: ${name}`);
    return await def.handle(toolArgs(args), ctx);
}
//# sourceMappingURL=tools.js.map