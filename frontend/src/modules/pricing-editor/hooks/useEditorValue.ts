import { useContext } from "react";
import { EditorValueContext } from "../contexts/editorValueContext";

export const useEditorValue = () => {
    const { editorValue, setEditorValue, editorMode, setEditorMode } = useContext(EditorValueContext);

    return { editorValue, setEditorValue, editorMode, setEditorMode };
};