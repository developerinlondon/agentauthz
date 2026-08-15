import type { ConditionKeys } from "../model/condition.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { McpServerOptions, McpTool } from "./types.js";
export interface ToolContext {
    options: McpServerOptions;
    descriptor: AuthzDescriptor;
    keys: ConditionKeys;
}
export declare function toolContext(options: McpServerOptions): ToolContext;
export declare function listTools(ctx: ToolContext): McpTool[];
export declare function isKnownTool(name: string): boolean;
export declare function runTool(name: string, args: unknown, ctx: ToolContext): Promise<unknown>;
//# sourceMappingURL=tools.d.ts.map