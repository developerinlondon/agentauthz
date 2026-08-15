// The MCP surface: JSON-RPC 2.0 over newline-delimited JSON, implemented here
// rather than taken as a dependency — this package has none, and an
// authorization engine acquiring its first runtime dependency to speak a
// framing protocol is a poor trade.

import { AuthzError } from "../model/errors.js";
import { isKnownTool, listTools, runTool, toolContext } from "./tools.js";
import type {
  JsonRpcId,
  JsonRpcResponse,
  McpServer,
  McpServerOptions,
  McpTool,
  McpToolResult,
  StdioStreams,
} from "./types.js";

// The revision this server implements. A client asking for the other revision
// here is answered in ITS revision; anything else is answered in ours, which
// the spec leaves the client to accept or close. 2025-03-26 is deliberately
// absent: its stdio transport requires JSON-RPC batching, which this server
// refuses, so agreeing to it would be a promise not kept.
export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2024-11-05"];

const DEFAULT_SERVER_INFO = { name: "agentauthz", version: "0.5.0" };

const INSTRUCTIONS =
  "Read the vocabulary with authz_describe, list attachable policies with authz_policies, then "
  + "grant with authz_grant and probe the result with authz_check. Bounds and context values are "
  + "constrained by the tool schemas, which are generated from this host's own declarations; a "
  + "rejection quotes the engine, so correct the named condition and retry.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function failure(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function textResult(value: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

// An AuthzError's message was written for the caller, so it crosses verbatim —
// that is what lets a model correct a rejected bound without a human
// translating. Anything else reached us from code that never agreed to be read
// by an untrusted consumer: a driver's message can carry a connection string,
// a table name, or the contents of a row, and the tool's caller is an agent.
function errorText(error: unknown): McpToolResult {
  const text = error instanceof AuthzError ? error.message : "internal error";
  return { content: [{ type: "text", text }], isError: true };
}

function negotiateVersion(params: unknown): string {
  const requested = isRecord(params) ? params.protocolVersion : undefined;
  return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : PROTOCOL_VERSION;
}

interface NodeLikeProcess {
  stdin?: AsyncIterable<Uint8Array | string>;
  stdout?: { write(chunk: string): unknown; };
}

function hostProcess(): NodeLikeProcess | undefined {
  return (globalThis as { process?: NodeLikeProcess; }).process;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const ctx = toolContext(options);
  const serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;

  const callTool = async (name: string, args: unknown): Promise<McpToolResult> => {
    try {
      return textResult(await runTool(name, args, ctx));
    } catch (error) {
      return errorText(error);
    }
  };

  const callRoute = async (id: JsonRpcId, params: unknown): Promise<JsonRpcResponse> => {
    const name = isRecord(params) ? params.name : undefined;
    if (typeof name !== "string") return failure(id, -32602, "tools/call needs a tool name");
    // An unknown tool is a protocol mistake, not a failed operation: the client
    // asked for something tools/list never offered.
    if (!isKnownTool(name)) return failure(id, -32602, `Unknown tool: ${name}`);
    return ok(id, await callTool(name, isRecord(params) ? params.arguments : undefined));
  };

  const route = async (
    method: string,
    id: JsonRpcId,
    params: unknown,
  ): Promise<JsonRpcResponse> => {
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: negotiateVersion(params),
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: listTools(ctx) });
      case "tools/call":
        return await callRoute(id, params);
      default:
        return failure(id, -32601, `Method not found: ${method}`);
    }
  };

  const handleMessage = async (message: unknown): Promise<JsonRpcResponse | null> => {
    if (!isRecord(message)) return failure(null, -32600, "message must be a JSON-RPC object");
    if (message.jsonrpc !== "2.0") return failure(null, -32600, 'jsonrpc must be "2.0"');
    // A response is something we were sent, not something we answer.
    if (message.method === undefined && ("result" in message || "error" in message)) return null;
    if (typeof message.method !== "string") return failure(null, -32600, "method must be a string");
    // A notification gets no reply, not even for an unknown method.
    if (message.id === undefined) return null;
    // MCP forbids a null id; answering one is indistinguishable from the shape
    // this file reports protocol errors with.
    if (!isValidId(message.id)) return failure(null, -32600, "id must be a string or an integer");
    const id = message.id;
    try {
      return await route(message.method, id, message.params);
    } catch {
      return failure(id, -32603, "internal error");
    }
  };

  const runStdio = async (streams: StdioStreams = {}): Promise<void> => {
    const proc = hostProcess();
    const input = streams.input ?? proc?.stdin;
    const write = streams.write
      ?? ((chunk: string) => {
        proc?.stdout?.write(chunk);
      });
    if (!input) throw new Error("runStdio found no stdin — pass streams.input");

    const decoder = new TextDecoder();
    let buffer = "";
    const consume = async (line: string): Promise<void> => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        write(`${JSON.stringify(failure(null, -32700, "parse error"))}\n`);
        return;
      }
      // One bad line must never end the session: a throw escaping to the
      // for-await leaves the transport dead with no reply and no diagnosis.
      let response: JsonRpcResponse | null;
      try {
        response = await handleMessage(parsed);
      } catch {
        response = failure(null, -32603, "internal error");
      }
      if (response) write(`${JSON.stringify(response)}\n`);
    };

    for await (const chunk of input) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        await consume(line);
        newline = buffer.indexOf("\n");
      }
    }
    await consume(buffer);
  };

  return {
    handleMessage,
    listTools: (): McpTool[] => listTools(ctx),
    callTool,
    runStdio,
  };
}
