// The MCP surface: JSON-RPC 2.0 over newline-delimited JSON, implemented here
// rather than taken as a dependency — this package has none, and an
// authorization engine acquiring its first runtime dependency to speak a
// framing protocol is a poor trade.
import { isKnownTool, listTools, runTool, toolContext } from "./tools.js";
// The revision this server implements. A client asking for another revision we
// know is answered in ITS revision — the tools surface is identical across
// these three — and anything else is answered in ours, which the spec leaves
// the client to accept or close.
export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_SERVER_INFO = { name: "agentauthz", version: "0.5.0" };
const INSTRUCTIONS = "Read the vocabulary with authz_describe, list attachable policies with authz_policies, then "
    + "grant with authz_grant and probe the result with authz_check. Bounds and context values are "
    + "constrained by the tool schemas, which are generated from this host's own declarations; a "
    + "rejection quotes the engine, so correct the named condition and retry.";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function ok(id, result) {
    return { jsonrpc: "2.0", id, result };
}
function failure(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } };
}
function textResult(value) {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function errorText(error) {
    // Verbatim: an engine or store rejection is the message a model needs to
    // correct itself, and a paraphrase is a translation layer that can be wrong.
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: message }], isError: true };
}
function negotiateVersion(params) {
    const requested = isRecord(params) ? params.protocolVersion : undefined;
    return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : PROTOCOL_VERSION;
}
function hostProcess() {
    return globalThis.process;
}
export function createMcpServer(options) {
    const ctx = toolContext(options);
    const serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;
    const callTool = async (name, args) => {
        try {
            return textResult(await runTool(name, args, ctx));
        }
        catch (error) {
            return errorText(error);
        }
    };
    const callRoute = async (id, params) => {
        const name = isRecord(params) ? params.name : undefined;
        if (typeof name !== "string")
            return failure(id, -32602, "tools/call needs a tool name");
        // An unknown tool is a protocol mistake, not a failed operation: the client
        // asked for something tools/list never offered.
        if (!isKnownTool(name))
            return failure(id, -32602, `Unknown tool: ${name}`);
        return ok(id, await callTool(name, isRecord(params) ? params.arguments : undefined));
    };
    const route = async (method, id, params) => {
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
    const handleMessage = async (message) => {
        if (!isRecord(message))
            return failure(null, -32600, "message must be a JSON-RPC object");
        if (message.jsonrpc !== "2.0")
            return failure(null, -32600, 'jsonrpc must be "2.0"');
        // A response is something we were sent, not something we answer.
        if (message.method === undefined && ("result" in message || "error" in message))
            return null;
        if (typeof message.method !== "string")
            return failure(null, -32600, "method must be a string");
        // No id at all is a notification: acknowledged by doing the work, never by
        // a reply — including an error reply for a method we do not know.
        if (message.id === undefined)
            return null;
        const id = message.id;
        return await route(message.method, id, message.params);
    };
    const runStdio = async (streams = {}) => {
        const proc = hostProcess();
        const input = streams.input ?? proc?.stdin;
        const write = streams.write
            ?? ((chunk) => {
                proc?.stdout?.write(chunk);
            });
        if (!input)
            throw new Error("runStdio found no stdin — pass streams.input");
        const decoder = new TextDecoder();
        let buffer = "";
        const consume = async (line) => {
            const trimmed = line.trim();
            if (trimmed.length === 0)
                return;
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            }
            catch {
                write(`${JSON.stringify(failure(null, -32700, "parse error"))}\n`);
                return;
            }
            const response = await handleMessage(parsed);
            if (response)
                write(`${JSON.stringify(response)}\n`);
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
        listTools: () => listTools(ctx),
        callTool,
        runStdio,
    };
}
//# sourceMappingURL=server.js.map