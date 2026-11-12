import { useEffect, useMemo, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { FiAlertTriangle, FiCornerUpLeft } from 'react-icons/fi';
import { useMode } from '../../hooks/useTheme';
import GithubDarkTheme from '../../theme/editor-themes/GitHub-Dark.json';
import TextmateTheme from '../../theme/editor-themes/Textmate.json';
import { conflictLocations, type MergeResolver } from '../../hooks/useMergeResolver';

function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme('github-dark', GithubDarkTheme as editor.IStandaloneThemeData);
  monaco.editor.defineTheme('textmate', TextmateTheme as editor.IStandaloneThemeData);
}

/**
 * The YAML view: the result as it would be published, editable by hand. Lines
 * with a conflict that still needs a choice are marked in the editor and listed
 * below it. Typing takes over from the computed result until the edits are
 * discarded or a side is chosen.
 */
export default function YamlResultEditor({ resolver }: { resolver: MergeResolver }) {
  const { mode } = useMode();
  const { state, resultYaml, manualError, preview } = resolver;
  const [codeEditor, setCodeEditor] = useState<editor.IStandaloneCodeEditor | null>(null);
  const isManual = state.manualYaml !== null;

  const unresolved = useMemo(
    () => state.conflicts.filter(conflict => !state.choices[conflict.id]),
    [state.conflicts, state.choices]
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
          hoverMessage: { value: `Conflict: ${conflict.label}` },
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

  // A hand-typed result is checked for syntax here; the server checks the rest when it is sent.
  const problem = manualError ?? (!isManual && preview && !preview.validation.ok
    ? { line: preview.validation.line, message: preview.validation.error ?? 'The result is not a valid pricing.' }
    : null);

  return (
    <div className="space-y-3">
      {isManual && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tp-severity-info-border bg-tp-severity-info-bg px-3 py-2 text-xs text-tp-ink">
          <span>You edited the result by hand: it replaces the computed merge. Choosing a side discards your edits.</span>
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
      <div className="h-[24rem] overflow-hidden rounded-xl border border-tp-hairline">
        <Editor
          height="100%"
          defaultLanguage="yaml"
          value={resultYaml}
          onChange={value => resolver.editManual(value ?? '')}
          theme={mode === 'light' ? 'textmate' : 'github-dark'}
          beforeMount={defineThemes}
          onMount={setCodeEditor}
          options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false }}
        />
      </div>
      {problem && (
        <p role="alert" className="rounded-lg border border-tp-severity-error-border bg-tp-severity-error-bg px-3 py-2 text-xs text-tp-ink">
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
      {locations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-tp-slate">Conflicts still to choose in this result</p>
          <ul className="flex flex-wrap gap-1.5">
            {locations.map(({ conflict, position }) => (
              <li key={conflict.id}>
                <button
                  type="button"
                  onClick={() => reveal(position.startLineNumber)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-tp-severity-warning-border bg-tp-severity-warning-bg px-2.5 py-0.5 text-xs text-tp-ink transition-colors hover:border-tp-severity-warning"
                >
                  <FiAlertTriangle aria-hidden="true" className="h-3 w-3 text-tp-severity-warning" />
                  <span className="font-mono">{conflict.label}</span>
                  <span className="text-tp-steel">line {position.startLineNumber}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
