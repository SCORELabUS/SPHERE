import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { FiAlertCircle, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiInfo } from 'react-icons/fi';

import type { LintDiagnostic, LintSeverity } from '../../services/pricing2yaml/linter';

interface ProblemsPanelProps {
  diagnostics: LintDiagnostic[];
  errors: number;
  warnings: number;
  /** Called with the diagnostic the user wants to jump to in the editor. */
  onSelect: (diagnostic: LintDiagnostic) => void;
}

const SEVERITY_STYLES: Record<LintSeverity, { icon: JSX.Element; text: string }> = {
  error: {
    icon: <FiAlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />,
    text: 'text-red-300',
  },
  warning: {
    icon: <FiAlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />,
    text: 'text-amber-300',
  },
  info: {
    icon: <FiInfo className="h-3.5 w-3.5 shrink-0 text-sky-400" />,
    text: 'text-sky-300',
  },
};

/**
 * Lists every diagnostic reported by the linter and lets the user jump to the
 * offending line, the way an IDE "Problems" view does.
 */
export default function ProblemsPanel({
  diagnostics,
  errors,
  warnings,
  onSelect,
}: Readonly<ProblemsPanelProps>): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true);
  const isClean = diagnostics.length === 0;

  return (
    <div className="flex shrink-0 flex-col border-t border-white/10 bg-tp-surface-code">
      <button
        type="button"
        onClick={() => setIsExpanded(current => !current)}
        className="flex cursor-pointer items-center justify-between px-3 py-2 text-left transition-colors hover:bg-white/5"
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
          Problems
          {isClean ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold tracking-wide text-emerald-300">
              <FiCheckCircle className="h-3 w-3" />
              No issues
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              {errors > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-400/10 px-2 py-0.5 text-[9px] font-bold tracking-wide text-red-300">
                  <FiAlertCircle className="h-3 w-3" />
                  {errors}
                </span>
              )}
              {warnings > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold tracking-wide text-amber-300">
                  <FiAlertTriangle className="h-3 w-3" />
                  {warnings}
                </span>
              )}
            </span>
          )}
        </span>
        <motion.span animate={{ rotate: isExpanded ? 0 : 180 }} transition={{ duration: 0.2 }}>
          <FiChevronDown className="h-4 w-4 text-white/40" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && !isClean && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="max-h-48 overflow-y-auto border-t border-white/5"
          >
            {diagnostics.map(diagnostic => (
              <li key={diagnosticKey(diagnostic)}>
                <button
                  type="button"
                  onClick={() => onSelect(diagnostic)}
                  className="flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/5"
                >
                  {SEVERITY_STYLES[diagnostic.severity].icon}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] leading-snug text-white/80">
                      {diagnostic.message}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-white/35">
                      <span className={SEVERITY_STYLES[diagnostic.severity].text}>
                        Line {diagnostic.startLineNumber}, col {diagnostic.startColumn}
                      </span>
                      {diagnostic.path && <span className="font-mono">{diagnostic.path}</span>}
                      <span className="font-mono opacity-60">{diagnostic.code}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function diagnosticKey(diagnostic: LintDiagnostic): string {
  return `${diagnostic.code}:${diagnostic.path}:${diagnostic.startLineNumber}:${diagnostic.startColumn}:${diagnostic.message}`;
}
