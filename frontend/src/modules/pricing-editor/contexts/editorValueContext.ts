import { createContext } from "react";
import type { PricingDraft } from "../services/pricing2yaml";

export type EditorMode = 'code' | 'visual';

/** The published pricing version the editor was opened from. */
export interface EditorSourcePricing {
    organizationId: string;
    slug: string;
    collectionSlug: string | null;
    name: string;
    version: string;
}

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
    sourcePricing: EditorSourcePricing | null;
    setSourcePricing: (source: EditorSourcePricing | null) => void;
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
    sourcePricing: null,
    setSourcePricing: () => {},
});