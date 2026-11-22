import { useEffect, useMemo, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { FiCornerUpLeft } from 'react-icons/fi';
import { useMode } from '../../hooks/useTheme';
import GithubDarkTheme from '../../theme/editor-themes/GitHub-Dark.json';
import TextmateTheme from '../../theme/editor-themes/Textmate.json';
import { conflictLocations, type MergeResolver } from '../../hooks/useMergeResolver';
import { escapeMarkdown } from '../../utils/pricing-merge-resolver';

function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme('github-dark', GithubDarkTheme as editor.IStandaloneThemeData);
  monaco.editor.defineTheme('textmate', TextmateTheme as editor.IStandaloneThemeData);
}

/**
 * The YAML view: the result as it would be sent. Lines with a conflict that
 * still needs a choice are marked (their hover names it). Read-only, unless the
 * resolver is editable (an author proposing from their fork): typing then takes
 * over from the computed result until the edits are discarded or a side is
 * chosen. `fill` makes the editor take the height its container gives it.
 */
export default function YamlResultView({ resolver, fill = false }: { resolver: MergeResolver; fill?: boolean }) {
  const { mode } = useMode();
  const { state, resultYaml, preview, editable, isManual, manualError } = resolver;
  const [codeEditor, setCodeEditor] = useState<editor.IStandaloneCodeEditor | null>(null);

  const unresolved = useMemo(
    () => (isManual ? [] : state.conflicts.filter(conflict => !state.choices[conflict.id])),
    [isManual, state.conflicts, state.choices]
  );
  const locations = useMemo(() => conflictLocations(resultYaml, unresolved), [resultYaml, unresolved]);

  useEffect(() => {
    if (!codeEditor) return;
    const decorations = codeEditor.createDecorationsCollection(
      locations.map(({ conflict, position }) => ({
        range: {
          startLineNumber: position.startLineNumber,
          startColumn: 1,
          endLineNumber: position.startLineNumber,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: 'bg-tp-severity-warning-bg',
          linesDecorationsClassName: 'border-l-4 border-tp-severity-warning',
          hoverMessage: { value: `Conflict: ${escapeMarkdown(conflict.label)}`, isTrusted: false, supportHtml: false },
        },
      }))
    );
    return () => decorations.clear();
  }, [codeEditor, locations]);

  const reveal = (line: number) => {
    if (!codeEditor) return;
    codeEditor.revealLineInCenter(line);
    codeEditor.setPosition({ lineNumber: line, column: 1 });
    codeEditor.focus();
  };

  // A result typed by hand is checked for syntax here; the server checks the rest when it is sent.
  const problem =
    manualError ??
    (!isManual && preview && !preview.validation.ok
      ? { line: preview.validation.line, message: preview.validation.error ?? 'The result is not a valid pricing.' }
      : null);

  return (
    <div className={fill ? 'flex h-full min-h-0 flex-col gap-3' : 'space-y-3'}>
      {isManual && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-tp-severity-info-border bg-tp-severity-info-bg px-3 py-2 text-xs text-tp-ink">
          <span>Edited by hand: this text is what you propose.</span>
          <button
            type="button"
            onClick={resolver.discardManual}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-2.5 py-1 font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            <FiCornerUpLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Discard my edits
          </button>
        </div>
      )}
      <div
        className={`overflow-hidden rounded-xl border border-tp-hairline ${fill ? 'min-h-[12rem] flex-1' : 'h-[24rem]'}`}
      >
        <Editor
          height="100%"
          defaultLanguage="yaml"
          value={resultYaml}
          onChange={editable ? value => resolver.editManual(value ?? '') : undefined}
          theme={mode === 'light' ? 'textmate' : 'github-dark'}
          beforeMount={defineThemes}
          onMount={setCodeEditor}
          options={{
            readOnly: !editable,
            domReadOnly: !editable,
            ...(editable ? {} : { readOnlyMessage: { value: 'The result changes by choosing a side for each conflict.' } }),
            minimap: { enabled: false },
            fontSize: 14,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
      {problem && (
        <p
          role="alert"
          className="shrink-0 rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-xs text-tp-ink"
        >
          {problem.line ? (
            <button
              type="button"
              onClick={() => reveal(problem.line!)}
              className="mr-1 cursor-pointer font-semibold underline underline-offset-2"
            >
              Line {problem.line}:
            </button>
          ) : null}
          {problem.message}
        </p>
      )}
    </div>
  );
}
