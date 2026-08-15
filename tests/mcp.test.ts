import { beforeEach, describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import type { AdminAuditRecord, AdminStore } from "../src/admin/types.js";
import { MemoryGrantStore } from "../src/conformance/memory.js";
import { makeAuthz } from "../src/core/authz.js";
import { describeAuthz } from "../src/core/describe.js";
import { createMcpServer, PROTOCOL_VERSION } from "../src/mcp/index.js";
import type { JsonRpcResponse, McpTool, McpToolResult } from "../src/mcp/types.js";
import type { GrantRecord, PolicyRecord } from "../src/model/grant.js";
import type { Scope } from "../src/model/scope.js";
import type { Subject } from "../src/model/subject.js";
import { actionRegistryFromCatalogue, type AuditEvent } from "../src/ports/index.js";

const rootScope: Scope = { kind: "root", id: "*" };
const space: Scope = { kind: "space", id: "acme" };
const agent: Subject = { kind: "agent", id: "drafter" };
const actor: Subject = { kind: "user", id: "admin@example.com" };

const catalogue = actionRegistryFromCatalogue([
  { action: "articles.read", title: "Read articles" },
  { action: "articles.publish", derivesFrom: "articles.read" },
]);

const conditionKeys = {
  "app:Region": { type: "string" as const, title: "Region" },
  "app:MaxCost": { type: "number" as const },
  "app:Owner": { type: "string" as const, lowercase: true },
  "app:NotAfter": { type: "date" as const },
};

const policy: PolicyRecord = {
  id: "p1",
  name: "publisher",
  description: null,
  statements: [{ effect: "allow", actions: ["articles.publish"], resources: ["article:*"] }],
  system: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let grants: MemoryGrantStore;
let audit: AdminAuditRecord[];
let nextAuditId: number;

// The reference in-memory store answers evaluation and the two writes; the
// listings a UI would read are kept alongside it, with ids mirroring the ones
// it assigns — a revoke that named the wrong id would fail against the real
// store, not silently pass here.
function adminStore(): AdminStore {
  const records: GrantRecord[] = [];
  let nextId = 1;
  return {
    listGrants: async (filter) =>
      records.filter((g) =>
        (!filter.policyId || g.policyId === filter.policyId)
        && (!filter.subjectId || g.subject.id === filter.subjectId)
        && (!filter.subjectKind || g.subject.kind === filter.subjectKind)
        && (!filter.scopeKind || g.scope.kind === filter.scopeKind)
        && (!filter.scopeId || g.scope.id === filter.scopeId)
      ),
    createGrant: async (input) => {
      await grants.createGrant(input);
      records.push({
        id: `g${nextId++}`,
        policyId: input.policyId,
        policyName: policy.name,
        subject: input.subject,
        scope: input.scope,
        ...(input.bounds ? { bounds: input.bounds } : {}),
        createdBy: input.createdBy,
        createdAt: new Date(0).toISOString(),
      });
    },
    deleteGrant: async (id) => {
      const removed = await grants.deleteGrant(id);
      const i = records.findIndex((g) => g.id === id);
      if (i !== -1) records.splice(i, 1);
      return removed;
    },
    listPolicies: async () => [policy],
    listAudit: async ({ action, limit }) =>
      audit.filter((r) => !action || r.action === action).slice(0, limit ?? audit.length),
  };
}

const auditSink = {
  record: (e: AuditEvent) => {
    audit.unshift({
      id: `a${nextAuditId++}`,
      at: new Date(0).toISOString(),
      subject: e.subjects[0] ?? { kind: "anonymous", id: "anonymous" },
      action: e.action,
      resource: e.resource,
      decision: e.decision,
      source: e.source,
      detail: e.detail,
    });
  },
};

function makeServer() {
  grants = new MemoryGrantStore(rootScope);
  grants.addPolicy({ id: policy.id, name: policy.name, statements: policy.statements });
  const authz = makeAuthz({
    grantStore: grants,
    actionRegistry: catalogue,
    conditionKeys,
    scopeKinds: ["root", "space"],
    defaultScopeChain: [rootScope],
    auditSink,
  });
  return createMcpServer({ authz, store: adminStore(), actor, auditSink });
}

let server: ReturnType<typeof makeServer>;

beforeEach(() => {
  audit = [];
  nextAuditId = 1;
  server = makeServer();
});

let nextRequestId = 1;
const request = (method: string, params?: unknown) =>
  server.handleMessage({
    jsonrpc: "2.0",
    id: nextRequestId++,
    method,
    ...(params ? { params } : {}),
  });

async function call(name: string, args?: unknown): Promise<McpToolResult> {
  return await server.callTool(name, args);
}

function payload(result: McpToolResult): unknown {
  return JSON.parse(result.content[0]!.text);
}

function toolNamed(tools: McpTool[], name: string): McpTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
}

function properties(tool: McpTool): Record<string, Record<string, unknown>> {
  return tool.inputSchema.properties as Record<string, Record<string, unknown>>;
}

const grantArgs = { policyId: "p1", subject: agent, scope: space };
const chain = [rootScope, space];

describe("the JSON-RPC surface", () => {
  test("initialize answers with tools capability and the negotiated revision", async () => {
    const res = await request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    const result = res!.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    // A client that reports which server it is talking to must not be told a
    // version this package stopped being.
    expect(result.serverInfo).toEqual({ name: pkg.name, version: pkg.version });
  });

  test("a client on an older known revision is answered in its own", async () => {
    const res = await request("initialize", { protocolVersion: "2024-11-05" });
    expect((res!.result as { protocolVersion: string; }).protocolVersion).toBe("2024-11-05");
  });

  test("a revision this server does not know is answered in this server's", async () => {
    const res = await request("initialize", { protocolVersion: "1999-01-01" });
    expect((res!.result as { protocolVersion: string; }).protocolVersion).toBe(PROTOCOL_VERSION);
  });

  test("notifications are acknowledged by silence, never by a reply", async () => {
    expect(await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }))
      .toBeNull();
    expect(await server.handleMessage({ jsonrpc: "2.0", method: "notifications/unheard-of" }))
      .toBeNull();
  });

  test("ping answers empty", async () => {
    expect((await request("ping"))!.result).toEqual({});
  });

  test("an unknown tool is a protocol error, not a failed operation", async () => {
    const res = await request("tools/call", { name: "authz_nope", arguments: {} });
    expect(res!.error).toEqual({ code: -32602, message: "Unknown tool: authz_nope" });
  });

  test("malformed messages are refused without touching the engine", async () => {
    expect((await server.handleMessage("not a message"))!.error!.code).toBe(-32600);
    expect((await server.handleMessage({ id: 1, method: "ping" }))!.error!.code).toBe(-32600);
    expect((await server.handleMessage({ jsonrpc: "2.0", id: 1 }))!.error!.code).toBe(-32600);
    expect((await request("tools/nope"))!.error!.code).toBe(-32601);
    expect((await request("tools/call", { arguments: {} }))!.error!.code).toBe(-32602);
  });

  test("a response we are sent is not something we answer", async () => {
    expect(await server.handleMessage({ jsonrpc: "2.0", id: 1, result: {} })).toBeNull();
  });
});

describe("the stdio transport", () => {
  async function drive(chunks: string[]): Promise<JsonRpcResponse[]> {
    const written: string[] = [];
    async function* input() {
      for (const c of chunks) yield new TextEncoder().encode(c);
    }
    await server.runStdio({ input: input(), write: (c) => written.push(c) });
    return written.join("").trimEnd().split("\n").filter((l) => l.length > 0).map((l) =>
      JSON.parse(l) as JsonRpcResponse
    );
  }

  test("newline-delimited messages are answered in order, across chunk splits", async () => {
    const responses = await drive([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/ini',
      'tialized"}\n{"jsonrpc":"2.0","id":2,"method":"too',
      'ls/list"}\n',
    ]);
    expect(responses.map((r) => r.id)).toEqual([1, 2]);
    expect((responses[1]!.result as { tools: McpTool[]; }).tools.length).toBeGreaterThan(0);
  });

  test("a final line without a newline is still answered", async () => {
    const responses = await drive(['{"jsonrpc":"2.0","id":7,"method":"ping"}']);
    expect(responses.map((r) => r.id)).toEqual([7]);
  });

  test("unparseable input is a parse error, and the stream continues", async () => {
    const responses = await drive(['{ not json\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n']);
    expect(responses[0]!.error!.code).toBe(-32700);
    expect(responses[1]!.id).toBe(2);
  });
});

describe("tool schemas are generated from the descriptor", () => {
  test("tools/list serves the whole surface", async () => {
    const res = await request("tools/list");
    const names = (res!.result as { tools: McpTool[]; }).tools.map((t) => t.name);
    expect(names).toEqual([
      "authz_check",
      "authz_grant",
      "authz_revoke",
      "authz_grants",
      "authz_policies",
      "authz_audit_query",
      "authz_describe",
    ]);
  });

  test("the check tool's action and scope fields are closed by the declarations", () => {
    const props = properties(toolNamed(server.listTools(), "authz_check"));
    expect(props.action!.enum).toEqual(["articles.read", "articles.publish"]);
    const scope = props.scopeChain!.items as { properties: Record<string, { enum: string[]; }>; };
    expect(scope.properties.kind!.enum).toEqual(["root", "space"]);
  });

  test("the check tool's context carries one typed property per host key", () => {
    const props = properties(toolNamed(server.listTools(), "authz_check"));
    const context = props.context!.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(context).sort()).toEqual([
      "app:MaxCost",
      "app:NotAfter",
      "app:Owner",
      "app:Region",
    ]);
    // A string key may arrive multi-valued (several roles at once); the others
    // are scalars typed by their declaration.
    expect(context["app:Region"]!.type).toEqual(["string", "array"]);
    expect(context["app:MaxCost"]!.type).toBe("number");
    expect(context["app:NotAfter"]).toMatchObject({ type: "string", format: "date-time" });
    // Declared lowercase reaches the model rather than surprising it at compare
    // time.
    expect(context["app:Owner"]!.description).toContain("lowercased");
  });

  test("built-in request:* keys are absent from context — the engine populates them", () => {
    const props = properties(toolNamed(server.listTools(), "authz_check"));
    const context = props.context!.properties as Record<string, unknown>;
    expect(context["request:Time"]).toBeUndefined();
    expect(context["request:SourceIp"]).toBeUndefined();
    expect(props.sourceIp!.type).toBe("string");
  });

  test("each key contributes bound branches typed by its declaration", () => {
    const props = properties(toolNamed(server.listTools(), "authz_grant"));
    const branches = (props.bounds!.items as { anyOf: Record<string, unknown>[]; }).anyOf;
    const byTitle = new Map(branches.map((b) => [b.title as string, b]));
    const scalarOps = (title: string) =>
      (byTitle.get(title)!.properties as Record<string, { enum: string[]; }>).operator!.enum;

    // A string key admits the set operators; a number key never does.
    expect(byTitle.has("app:Region (set membership)")).toBe(true);
    expect(byTitle.has("app:MaxCost (set membership)")).toBe(false);
    expect(scalarOps("app:MaxCost")).toEqual(["NumericLessThan", "NumericGreaterThan"]);
    expect(scalarOps("app:NotAfter")).toEqual(["DateLessThan", "DateGreaterThan"]);
    // A numeric bound authored as a JSON number is legal; the engine normalizes
    // it rather than bouncing the caller into quoting a number it already has.
    const value = (byTitle.get("app:MaxCost")!.properties as Record<string, { type: unknown; }>)
      .value;
    expect(value!.type).toEqual(["string", "number"]);
    // The built-in keys ARE bindable as bounds, unlike as context.
    expect(byTitle.has("request:SourceIp")).toBe(true);
  });

  // The acceptance criterion: a host that declares one more condition key gets
  // a tool schema that already knows about it, with nothing here edited.
  test("a vocabulary change alone changes the schemas", () => {
    const base = { store: adminStore(), actor };
    const authzOf = (keys: Record<string, { type: "string" | "number"; }>) =>
      makeAuthz({
        grantStore: new MemoryGrantStore(rootScope),
        actionRegistry: catalogue,
        conditionKeys: keys,
        scopeKinds: ["root", "space"],
      });
    const before = createMcpServer({
      ...base,
      authz: authzOf({ "app:Region": { type: "string" } }),
    });
    const after = createMcpServer({
      ...base,
      authz: authzOf({ "app:Region": { type: "string" }, "app:Tier": { type: "number" } }),
    });

    const boundsOf = (s: typeof before) =>
      (properties(toolNamed(s.listTools(), "authz_grant")).bounds!.items as {
        anyOf: { title: string; }[];
      }).anyOf.map((b) => b.title);
    const contextOf = (s: typeof before) =>
      Object.keys(properties(toolNamed(s.listTools(), "authz_check")).context!.properties!);

    expect(boundsOf(before)).not.toContain("app:Tier");
    expect(boundsOf(after)).toContain("app:Tier");
    expect(contextOf(before)).toEqual(["app:Region"]);
    expect(contextOf(after)).toEqual(["app:Region", "app:Tier"]);
  });

  test("a supplied descriptor overrides the engine's own", () => {
    const narrowed = describeAuthz({ actionRegistry: catalogue, scopeKinds: ["root"] });
    const s = createMcpServer({
      authz: makeAuthz({ grantStore: grants, actionRegistry: catalogue }),
      store: adminStore(),
      descriptor: narrowed,
    });
    const props = properties(toolNamed(s.listTools(), "authz_grant"));
    const kinds = (props.scope!.properties as Record<string, { enum: string[]; }>).kind!.enum;
    expect(kinds).toEqual(["root"]);
  });
});

describe("the tools carry out real work", () => {
  test("authz_describe serves the vocabulary the schemas were built from", async () => {
    const result = payload(await call("authz_describe")) as { conditionKeys: object; };
    expect(Object.keys(result.conditionKeys)).toContain("app:Region");
  });

  test("authz_policies lists what a grant may attach", async () => {
    expect(payload(await call("authz_policies"))).toEqual([policy]);
  });

  test("a grant is created, attributed to the host's actor, and then allows", async () => {
    const granted = await call("authz_grant", grantArgs);
    expect(granted.isError).toBeUndefined();

    const denied = payload(
      await call("authz_check", {
        subjects: [agent],
        action: "articles.publish",
        resource: "article:42",
      }),
    ) as { allowed: boolean; };
    // The default chain is root only — the grant lives at the space.
    expect(denied.allowed).toBe(false);

    const allowed = payload(
      await call("authz_check", {
        subjects: [agent],
        action: "articles.publish",
        resource: "article:42",
        scopeChain: chain,
      }),
    ) as { allowed: boolean; decision: string; allowedByStoredGrants: boolean; };
    expect(allowed).toEqual({
      allowed: true,
      decision: "allow",
      allowedByStoredGrants: true,
    });

    const listed = payload(await call("authz_grants", { subjectId: "drafter" })) as GrantRecord[];
    expect(listed[0]).toMatchObject({ id: "g1", policyId: "p1", createdBy: actor.id });
  });

  test("a resource the policy never named is denied", async () => {
    await call("authz_grant", grantArgs);
    const result = payload(
      await call("authz_check", {
        subjects: [agent],
        action: "articles.publish",
        resource: "invoice:9",
        scopeChain: chain,
      }),
    ) as { allowed: boolean; decision: string; };
    expect(result).toMatchObject({ allowed: false, decision: "deny" });
  });

  // The bound the schema advertised, honoured end to end: the same key the
  // grant tool typed is the one the check tool populates.
  test("a bound grant allows only inside its bound", async () => {
    const bounded = await call("authz_grant", {
      ...grantArgs,
      bounds: [{ operator: "StringEquals", key: "app:Region", value: "eu-west" }],
    });
    expect(bounded.isError).toBeUndefined();

    const probe = async (region: string) =>
      (payload(
        await call("authz_check", {
          subjects: [agent],
          action: "articles.publish",
          resource: "article:42",
          scopeChain: chain,
          context: { "app:Region": region },
        }),
      ) as { allowed: boolean; }).allowed;

    expect(await probe("eu-west")).toBe(true);
    expect(await probe("us-east")).toBe(false);
  });

  test("a revoke removes the grant, and an unknown id says so", async () => {
    await call("authz_grant", grantArgs);
    expect((await call("authz_revoke", { grantId: "g1" })).isError).toBeUndefined();
    expect(payload(await call("authz_grants", {}))).toEqual([]);

    const missing = await call("authz_revoke", { grantId: "g1" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toBe('grant "g1" not found');
  });

  test("writes are auditable, attributed, and marked with the door they came through", async () => {
    await call("authz_grant", grantArgs);
    await call("authz_revoke", { grantId: "g1" });

    const rows = payload(await call("authz_audit_query", {})) as AdminAuditRecord[];
    const writes = rows.filter((r) => r.decision === "executed");
    expect(writes.map((r) => r.action)).toEqual(["authz.grant.revoke", "authz.grant.create"]);
    expect(writes.every((r) => r.subject.id === actor.id)).toBe(true);
    expect(writes.every((r) => r.source === "authz-mcp")).toBe(true);
    expect(writes[1]!.detail).toMatchObject({ scope: space });

    const filtered = payload(
      await call("authz_audit_query", { action: "authz.grant.create", limit: 5 }),
    ) as AdminAuditRecord[];
    expect(filtered).toHaveLength(1);
  });
});

describe("rejections reach the model in the engine's own words", () => {
  test("an unknown condition key is quoted verbatim from validateConditions", async () => {
    const result = await call("authz_grant", {
      ...grantArgs,
      bounds: [{ operator: "StringEquals", key: "app:Nope", value: "x" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('condition 0: unknown key "app:Nope"');
    expect(payload(await call("authz_grants", {}))).toEqual([]);
  });

  test("an operator the key's type forbids is quoted verbatim too", async () => {
    const result = await call("authz_grant", {
      ...grantArgs,
      bounds: [{ operator: "NumericLessThan", key: "app:Region", value: "4" }],
    });
    expect(result.content[0]!.text).toBe(
      "condition 0: NumericLessThan cannot test app:Region (a string key)",
    );
  });

  test("a timezone-less date bound explains the fix, in full", async () => {
    const result = await call("authz_grant", {
      ...grantArgs,
      bounds: [{ operator: "DateLessThan", key: "app:NotAfter", value: "2026-08-01T00:00:00" }],
    });
    expect(result.content[0]!.text).toBe(
      'condition 0: "2026-08-01T00:00:00" has no timezone — use Z or an explicit ±HH:MM offset '
        + "(a bare timestamp parses in the SERVER's local time)",
    );
  });

  test("a store rejection is passed through, not translated", async () => {
    const result = await call("authz_grant", { ...grantArgs, policyId: "p9" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("unknown policy p9");
  });

  test("an undeclared scope kind is refused before the store is reached", async () => {
    const result = await call("authz_grant", { ...grantArgs, scope: { kind: "galaxy", id: "x" } });
    expect(result.content[0]!.text).toBe('scope kind "galaxy" is not declared');
    expect(payload(await call("authz_grants", {}))).toEqual([]);
  });

  test("malformed arguments name the offending field", async () => {
    expect((await call("authz_grant", { subject: agent, scope: space })).content[0]!.text)
      .toBe("policyId is required");
    expect((await call("authz_grant", { ...grantArgs, subject: "drafter" })).content[0]!.text)
      .toBe("subject must be {kind, id}");
    expect((await call("authz_grant", { ...grantArgs, bounds: "eu-west" })).content[0]!.text)
      .toBe("bounds must be an array");
    expect(
      (await call("authz_check", { subjects: [], action: "articles.read", resource: "a" }))
        .content[0]!.text,
    ).toBe("subjects must be a non-empty array of {kind, id}");
    expect(
      (await call("authz_check", {
        subjects: [agent],
        action: "articles.read",
        resource: "a",
        context: { "app:Region": { nested: true } },
      })).content[0]!.text,
    ).toBe('context["app:Region"] must be a string, a number, or an array of strings');
  });
});
