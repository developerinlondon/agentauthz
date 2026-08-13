import type { AuthzDescriptor } from "../model/descriptor.js";
import { type DraftBound } from "./derive.js";
export interface BoundsEditorProps {
    descriptor: AuthzDescriptor;
    bounds: DraftBound[];
    onChange(next: DraftBound[]): void;
}
export declare function BoundsEditor(props: BoundsEditorProps): import("react").JSX.Element;
//# sourceMappingURL=BoundsEditor.d.ts.map