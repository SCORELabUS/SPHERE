import type { Monaco } from '@monaco-editor/react';
import type monaco from 'monaco-editor';

import { indentBlock, planBlockInsertion, type SnippetPlacement } from './insert';
import { resolveSnippetBody, type Pricing2YamlSnippet } from './types';

type CodeEditor = monaco.editor.IStandaloneCodeEditor;

/** Monaco's snippet contribution, which owns tab stops and placeholder editing. */
interface SnippetController {
  insert: (template: string) => void;
}

const SNIPPET_CONTROLLER_ID = 'snippetController2';
const EDIT_SOURCE = 'pricing2yaml-snippets';

/** Indentation given to a block whose section has to be expanded with it. */
const ROOT_COMPLETION_INDENT = '  ';

/**
 * Drops a snippet into the editor: blocks go to their section, whole pricings
 * replace the document. Tab stops stay live, so the user tabs through the
 * placeholders as in any IDE.
 */
export function insertSnippet(editor: CodeEditor, snippet: Pricing2YamlSnippet): void {
  const model = editor.getModel();

  if (!model) {
    return;
  }

  const body = resolveSnippetBody(snippet);
  const placement =
    snippet.kind === 'block' && snippet.section
      ? planBlockInsertion(model.getValue(), snippet.section, body)
      : replaceWholeDocument(model, body);

  editor.focus();
  editor.setSelection(placement);
  editor.revealLineInCenterIfOutsideViewport(placement.startLineNumber);

  const controller = editor.getContribution(SNIPPET_CONTROLLER_ID) as unknown as
    | SnippetController
    | null;

  if (typeof controller?.insert === 'function') {
    controller.insert(placement.text);

    return;
  }

  // Without the contribution there are no tab stops, so the placeholders are
  // flattened to their default text rather than left as snippet syntax.
  editor.executeEdits(EDIT_SOURCE, [
    { range: placement, text: stripPlaceholders(placement.text), forceMoveMarkers: true },
  ]);
}

/**
 * Offers the snippets as YAML completions, so typing `plan` and accepting the
 * suggestion is enough to get a well-formed plan.
 */
export function registerSnippetCompletions(
  monacoInstance: Monaco,
  snippets: readonly Pricing2YamlSnippet[]
): monaco.IDisposable {
  return monacoInstance.languages.registerCompletionItemProvider('yaml', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: snippets.map((snippet, index) => ({
          label: snippet.prefix,
          kind: monacoInstance.languages.CompletionItemKind.Snippet,
          detail: snippet.detail,
          documentation: { value: describeSnippet(snippet) },
          insertText: buildCompletionText(model, position, snippet),
          insertTextRules:
            monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          filterText: snippet.prefix,
          // Blocks are the everyday case; whole documents sort last.
          sortText: `${snippet.kind === 'block' ? '0' : '1'}${String(index).padStart(2, '0')}`,
          range,
        })),
      };
    },
  });
}

/**
 * Binds every snippet to a command, so they show up in the editor context menu
 * and in the command palette.
 */
export function registerSnippetActions(
  editor: CodeEditor,
  snippets: readonly Pricing2YamlSnippet[]
): monaco.IDisposable[] {
  return snippets.map((snippet, index) =>
    editor.addAction({
      id: `pricing2yaml.insert.${snippet.id}`,
      label: `Pricing2Yaml: Insert ${snippet.label}`,
      contextMenuGroupId: 'pricing2yaml',
      contextMenuOrder: index,
      run: () => insertSnippet(editor, snippet),
    })
  );
}

/**
 * Binds `Ctrl/Cmd + K` to opening the templates menu.
 *
 * A single keystroke rather than a chord per template: a chord gives no visible
 * feedback until its second key, so pressing `Ctrl/Cmd + K` on its own looks
 * like nothing happened, and its letters collide with Monaco's own
 * `Ctrl/Cmd + K` chords. Opening the menu shows every template with the prefix
 * that inserts it.
 */
export function registerTemplatesMenuAction(
  editor: CodeEditor,
  monacoInstance: Monaco,
  open: () => void
): monaco.IDisposable {
  return editor.addAction({
    id: 'pricing2yaml.openTemplates',
    label: 'Pricing2Yaml: Open templates menu',
    keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK],
    run: () => open(),
  });
}

/** Label of the templates shortcut, the way the running platform spells it. */
export function templatesShortcutLabel(): string {
  return isMacPlatform() ? '⌘K' : 'Ctrl+K';
}

/**
 * Completions expand where the caret is, so a block typed at the root of the
 * document would end up without its parent section. When that happens the
 * header is expanded along with it; anywhere else the body goes in untouched
 * and Monaco lines it up with the surrounding indentation.
 */
function buildCompletionText(
  model: monaco.editor.ITextModel,
  position: monaco.IPosition,
  snippet: Pricing2YamlSnippet
): string {
  const body = resolveSnippetBody(snippet);

  if (snippet.kind !== 'block' || !snippet.section) {
    return body;
  }

  const isAtRoot = !/^\s/.test(model.getLineContent(position.lineNumber));

  if (!isAtRoot || findEnclosingSection(model, position.lineNumber) === snippet.section) {
    return body;
  }

  return `${snippet.section}:\n${indentBlock(body, ROOT_COMPLETION_INDENT)}`;
}

/** Name of the top-level section the given line sits under, if any. */
function findEnclosingSection(
  model: monaco.editor.ITextModel,
  lineNumber: number
): string | undefined {
  for (let line = lineNumber; line >= 1; line--) {
    const text = model.getLineContent(line);

    if (text.trim().length === 0 || /^\s/.test(text)) {
      continue;
    }

    const match = /^([A-Za-z0-9_]+)\s*:(.*)$/.exec(text);

    // A key carrying its own value (`addOns: null`) opens no section.
    return match && match[2].trim().length === 0 ? match[1] : undefined;
  }

  return undefined;
}

function replaceWholeDocument(model: monaco.editor.ITextModel, body: string): SnippetPlacement {
  const range = model.getFullModelRange();

  return {
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
    text: body,
  };
}

function describeSnippet(snippet: Pricing2YamlSnippet): string {
  const preview = stripPlaceholders(resolveSnippetBody(snippet));

  return `${snippet.documentation}\n\n\`\`\`yaml\n${preview}\n\`\`\``;
}

/** Turns snippet syntax into the plain text it defaults to. */
export function stripPlaceholders(template: string): string {
  return template
    .replace(/\$\{\d+\|([^|]*)\|\}/g, (_match, choices: string) => choices.split(',')[0] ?? '')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\}/g, '')
    .replace(/\$\d+/g, '');
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /mac|iphone|ipad/i.test(navigator.userAgent);
}
