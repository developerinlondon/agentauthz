import type { SubjectSummary } from "../admin/types.js";
import type { AuthzDescriptor } from "../model/descriptor.js";
import type { PolicyRecord } from "../model/grant.js";
import { toCondition } from "./derive.js";
export interface GrantEditorProps {
    descriptor: AuthzDescriptor;
    policies: PolicyRecord[];
    searchSubjects(q: string): Promise<SubjectSummary[]>;
    onCreate(input: {
        policyId: string;
        subject: {
            kind: string;
            id: string;
        };
        scope: {
            kind: string;
            id: string;
        };
        bounds?: ReturnType<typeof toCondition>[];
    }): Promise<void>;
}
export declare function GrantEditor(props: GrantEditorProps): import("react").JSX.Element;
//# sourceMappingURL=GrantEditor.d.ts.map