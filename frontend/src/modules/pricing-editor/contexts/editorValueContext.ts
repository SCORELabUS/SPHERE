import { createContext } from "react";
import type { PricingDraft } from "../services/pricing2yaml";

export type EditorMode = 'code' | 'visual';

export interface EditorValueContextInteface {
    editorValue: string;
    setEditorValue: (editorValue: string) => void;
    editorMode: EditorMode;
    setEditorMode: (mode: EditorMode) => void;
    isDirty: boolean;
    setIsDirty: (v: boolean) => void;
    pendingVisualDraft: PricingDraft | null;
    setPendingVisualDraft: (d: PricingDraft | null) => void;
    saveDraft: () => void;
}

export const EditorValueContext = createContext<EditorValueContextInteface>({
    editorValue: '',
    setEditorValue: () => {},
    editorMode: 'code',
    setEditorMode: () => {},
    isDirty: false,
    setIsDirty: () => {},
    pendingVisualDraft: null,
    setPendingVisualDraft: () => {},
    saveDraft: () => {},
});