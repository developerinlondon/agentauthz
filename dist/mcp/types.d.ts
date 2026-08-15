import type { AdminStore } from "../admin/types.js";
import type { Authz } from "../core/authz.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { Subject } from "../model/subject.js";
import type { AuditSink } from "../ports/index.js";
import type { JsonSchema } from "./schema.js";
export interface McpServerOptions {
    authz: Authz;
    store: AdminStore;
    descriptor?: AuthzDescriptor;
    actor?: Subject | null;
    auditSink?: AuditSink;
    serverInfo?: {
        name: string;
        version: string;
    };
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
export interface StdioStreams {
    input?: AsyncIterable<Uint8Array | string>;
    write?: (chunk: string) => void;
}
export interface McpServer {
    handleMessage(message: unknown): Promise<JsonRpcResponse | null>;
    listTools(): McpTool[];
    callTool(name: string, args: unknown): Promise<McpToolResult>;
    runStdio(streams?: StdioStreams): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map