import { createContext } from "react";

export type EditorMode = 'code' | 'visual';

export interface EditorValueContextInteface {
    editorValue: string;
    setEditorValue: (editorValue: string) => void;
    editorMode: EditorMode;
    setEditorMode: (mode: EditorMode) => void;
}

export const EditorValueContext = createContext<EditorValueContextInteface>({
    editorValue: '',
    setEditorValue: () => {},
    editorMode: 'code',
    setEditorMode: () => {},
});