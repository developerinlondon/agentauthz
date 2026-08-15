import type { AdminStore } from "../admin/types.js";
import type { Authz } from "../core/authz.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { Subject } from "../model/subject.js";
import type { AuditSink } from "../ports/index.js";
import type { JsonSchema } from "./schema.js";

export interface McpServerOptions {
  // The engine itself, so a tool answers a check the same way the host's own
  // call sites do — and so the tool vocabulary comes from authz.describe()
  // with nothing for the host to keep in sync.
  authz: Authz;
  store: AdminStore;
  // Overrides authz.describe(). For a host that serves a narrowed vocabulary
  // to its agents; the ENGINE still decides by its own, so narrowing here
  // withholds options rather than granting any.
  descriptor?: AuthzDescriptor;
  // Who is performing the write, resolved by the host for this connection —
  // recorded as the grant's creator and as the audit row's subject. An MCP
  // session has no per-request identity, so a host serving several
  // administrators builds one server per session.
  actor?: Subject | null;
  auditSink?: AuditSink;
  serverInfo?: { name: string; version: string; };
}

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface McpContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpContent[];
  isError?: true;
}

export type JsonRpcId = string | number | null;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

// Newline-delimited JSON in, newline-delimited JSON out — the standard MCP
// stdio transport. Injectable so the framing is exercised without a process.
export interface StdioStreams {
  input?: AsyncIterable<Uint8Array | string>;
  write?: (chunk: string) => void;
}

export interface McpServer {
  // One JSON-RPC message in, one response out — or null for a notification,
  // which by definition has no reply. The whole protocol surface, so a host
  // can carry it over any transport it already has.
  handleMessage(message: unknown): Promise<JsonRpcResponse | null>;
  listTools(): McpTool[];
  callTool(name: string, args: unknown): Promise<McpToolResult>;
  runStdio(streams?: StdioStreams): Promise<void>;
}
