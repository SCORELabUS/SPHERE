import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { FiEye, FiEyeOff, FiX } from 'react-icons/fi';
import type { VersionData } from '../../types/card';

interface VersionsVisibilityModalProps {
  versions: VersionData[];
  currentVersionId?: string;
  onClose: () => void;
}

function VisibilityPill({ isPrivate }: { isPrivate: boolean }) {
  const Icon = isPrivate ? FiEyeOff : FiEye;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isPrivate
          ? 'bg-tp-surface text-tp-slate ring-1 ring-tp-hairline-strong'
          : 'bg-emerald-100 text-emerald-800'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {isPrivate ? 'Private' : 'Public'}
    </span>
  );
}

/** Every version of a pricing with its visibility, in one read-only list. */
export default function VersionsVisibilityModal({
  versions,
  currentVersionId,
  onClose,
}: VersionsVisibilityModalProps) {
  const privateCount = versions.filter(v => v.private).length;
  const publicCount = versions.length - privateCount;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="versions-visibility-title"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex max-h-[80dvh] w-full max-w-[30rem] cursor-default flex-col overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas shadow-elevation-4"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-tp-hairline px-5 py-4">
          <div>
            <h2
              id="versions-visibility-title"
              className="font-display text-lg font-semibold text-tp-ink"
            >
              Versions visibility
            </h2>
            <p className="mt-0.5 text-sm text-tp-slate">
              {publicCount} public · {privateCount} private
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
          >
            <FiX className="h-5 w-5" />
          </button>
        </header>

        <ul className="min-h-0 flex-1 divide-y divide-tp-hairline overflow-y-auto">
          {versions.map(version => (
            <li key={version.id} className="flex items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-tp-ink">
                    {version.version}
                  </span>
                  {version.id === currentVersionId && (
                    <span className="rounded-full bg-tp-primary/10 px-2 py-0.5 text-[10px] font-medium text-tp-primary">
                      Current
                    </span>
                  )}
                </span>
                <span className="block text-xs text-tp-steel">
                  {format(parseISO(version.createdAt), 'PP')}
                </span>
              </span>
              <VisibilityPill isPrivate={version.private} />
            </li>
          ))}
        </ul>

        <footer className="flex justify-end border-t border-tp-hairline bg-tp-surface px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            Close
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
