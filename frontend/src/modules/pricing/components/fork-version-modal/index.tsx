import { useState } from 'react';
import { motion } from 'framer-motion';
import { VERSION_LABEL } from '../../utils/version-graph';

interface ForkVersionModalProps {
  /** What is forked: the pricing and version it comes from. */
  sourceName: string;
  sourceVersion: string;
  /** The pricing that gets it as its latest version. */
  targetName: string;
  /** The names the target pricing already uses, when known. */
  takenNames: string[];
  suggestedName: string;
  onConfirm: (versionName: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Asks the name of a version forked into an existing pricing and confirms that
 * it becomes that pricing's latest version.
 */
export default function ForkVersionModal({
  sourceName,
  sourceVersion,
  targetName,
  takenNames,
  suggestedName,
  onConfirm,
  onClose,
}: ForkVersionModalProps) {
  const [name, setName] = useState(suggestedName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const problem = !trimmed
    ? 'Name the version'
    : !VERSION_LABEL.test(trimmed)
      ? 'Use letters, digits, ".", "_", "+" or "-", starting with a letter or digit'
      : takenNames.includes(trimmed)
        ? `${targetName} already has a version ${trimmed}`
        : null;

  const submit = async () => {
    if (problem) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm(trimmed);
    } catch (err) {
      setError((err as Error).message);
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fork-version-title"
      onClick={onClose}
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-[28rem] cursor-default rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="fork-version-title" className="mb-2 font-display text-lg font-semibold text-tp-ink">
          Fork version {sourceVersion}
        </h2>
        <p className="mb-4 text-sm text-tp-steel">
          Copy version <span className="font-medium text-tp-ink">{sourceVersion}</span> of{' '}
          <span className="font-medium text-tp-ink">{sourceName}</span> into{' '}
          <span className="font-medium text-tp-ink">{targetName}</span>.
        </p>

        <label htmlFor="fork-version-name" className="mb-1 block text-xs font-medium text-tp-slate">
          Name of the forked version
        </label>
        <input
          id="fork-version-name"
          value={name}
          autoFocus
          maxLength={64}
          onChange={e => setName(e.target.value)}
          aria-invalid={problem !== null}
          aria-describedby="fork-version-hint"
          className="w-full rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 font-mono text-sm text-tp-ink outline-none focus:border-tp-primary"
        />
        <p
          id="fork-version-hint"
          className={`mt-1 text-xs ${problem && trimmed ? 'text-tp-severity-error' : 'text-tp-steel'}`}
        >
          {problem && trimmed ? problem : 'It names the version in its YAML and in its links.'}
        </p>

        <div className="mt-4 flex gap-2 rounded-lg border border-tp-primary/30 bg-tp-primary/5 px-3 py-2.5 text-xs text-tp-ink">
          <svg
            className="mt-px h-4 w-4 shrink-0 text-tp-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <span>
            It will be saved as the latest version of{' '}
            <span className="font-semibold">{targetName}</span>
            {trimmed && !problem ? (
              <>
                {' '}
                under the name <span className="font-mono font-semibold">{trimmed}</span>
              </>
            ) : null}
            .
          </span>
        </div>

        {error && <p className="mt-3 text-xs text-tp-severity-error">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={problem !== null || isSubmitting}
            className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? 'Forking…' : 'Fork as latest version'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
