import type { AuthzDescriptor } from "../model/descriptor.js";
export type JsonSchema = Record<string, unknown>;
export declare const SUBJECT_SCHEMA: JsonSchema;
export declare function scopeSchema(descriptor: AuthzDescriptor): JsonSchema;
export declare function actionSchema(descriptor: AuthzDescriptor): JsonSchema;
export declare function boundsSchema(descriptor: AuthzDescriptor): JsonSchema;
export declare function contextSchema(descriptor: AuthzDescriptor): JsonSchema | undefined;
//# sourceMappingURL=schema.d.ts.map