import { FiAlertTriangle } from 'react-icons/fi';

interface VisualEditorUnavailableProps {
  /** Why the document could not be turned into a draft. */
  message: string;
  onBackToCode: () => void;
}

/**
 * Stands in for the visual editor while the document cannot be read.
 *
 * The visual editor works on a draft parsed from the YAML, so a document that
 * does not parse has nothing to show. Rendering this instead of letting the
 * parse throw is what keeps a broken pricing from blanking the page.
 */
export function VisualEditorUnavailable({
  message,
  onBackToCode,
}: Readonly<VisualEditorUnavailableProps>): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-300 p-6">
      <div className="w-full max-w-[32rem] rounded-xl border border-amber-400/30 bg-white/80 p-6 text-center shadow-elevation-2">
        <FiAlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <h2 className="mt-3 text-base font-semibold text-slate-800">
          The visual editor needs a pricing it can read
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This document cannot be parsed yet, so there is nothing to lay out. Fix the problems
          listed under the code editor and switch back.
        </p>
        <p className="mt-3 break-words rounded-md bg-slate-900/5 px-3 py-2 text-left font-mono text-[11px] leading-snug text-slate-700">
          {message}
        </p>
        <button
          type="button"
          onClick={onBackToCode}
          className="mt-4 cursor-pointer rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700"
        >
          Back to the code editor
        </button>
      </div>
    </div>
  );
}
