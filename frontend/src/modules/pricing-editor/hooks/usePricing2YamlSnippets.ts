import type { Monaco } from '@monaco-editor/react';
import type monaco from 'monaco-editor';
import { useCallback, useEffect, useRef } from 'react';

import {
  insertSnippet,
  registerSnippetActions,
  registerSnippetCompletions,
  registerTemplatesMenuAction,
  type Pricing2YamlSnippet,
} from '../services/pricing2yaml/snippets';

/**
 * Makes the Pricing2Yaml templates reachable from the editor: as YAML
 * completions, as commands in the context menu, through the `Ctrl/Cmd + K`
 * shortcut that opens the templates menu, and as a callback for the menu
 * itself.
 */
export function usePricing2YamlSnippets(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  monacoInstance: Monaco | null,
  snippets: readonly Pricing2YamlSnippet[],
  onOpenTemplates: () => void
): (snippet: Pricing2YamlSnippet) => void {
  // Kept in a ref so a new callback identity does not re-register the command.
  const openTemplatesRef = useRef(onOpenTemplates);
  openTemplatesRef.current = onOpenTemplates;

  useEffect(() => {
    if (!monacoInstance) {
      return;
    }

    const disposable = registerSnippetCompletions(monacoInstance, snippets);

    // Registration is global to the language, so it has to be undone on unmount
    // or every remount would add another copy of every suggestion.
    return () => disposable.dispose();
  }, [monacoInstance, snippets]);

  useEffect(() => {
    if (!editor || !monacoInstance) {
      return;
    }

    const disposables = [
      ...registerSnippetActions(editor, snippets),
      registerTemplatesMenuAction(editor, monacoInstance, () => openTemplatesRef.current()),
    ];

    return () => disposables.forEach(disposable => disposable.dispose());
  }, [editor, monacoInstance, snippets]);

  return useCallback(
    (snippet: Pricing2YamlSnippet) => {
      if (editor) {
        insertSnippet(editor, snippet);
      }
    },
    [editor]
  );
}
