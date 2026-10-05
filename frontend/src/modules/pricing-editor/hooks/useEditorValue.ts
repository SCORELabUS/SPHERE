import { useContext } from "react";
import { EditorValueContext } from "../contexts/editorValueContext";

export const useEditorValue = () => {
    const {
        editorValue, setEditorValue,
        editorMode, setEditorMode,
        isDirty, setIsDirty,
        pendingVisualDraft, setPendingVisualDraft,
        saveDraft,
        sourcePricing, setSourcePricing,
    } = useContext(EditorValueContext);

    return {
        editorValue, setEditorValue,
        editorMode, setEditorMode,
        isDirty, setIsDirty,
        pendingVisualDraft, setPendingVisualDraft,
        saveDraft,
        sourcePricing, setSourcePricing,
    };
};