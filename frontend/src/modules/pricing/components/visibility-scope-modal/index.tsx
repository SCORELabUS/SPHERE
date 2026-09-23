import { useState } from 'react';
import { motion } from 'framer-motion';

export type VisibilityScope = 'version' | 'pricing';

interface VisibilityScopeModalProps {
  targetVisibility: 'Public' | 'Private';
  versionLabel: string;
  versionCount: number;
  isSubmitting: boolean;
  onConfirm: (scope: VisibilityScope) => void;
  onClose: () => void;
}

export default function VisibilityScopeModal({
  targetVisibility,
  versionLabel,
  versionCount,
  isSubmitting,
  onConfirm,
  onClose,
}: VisibilityScopeModalProps) {
  const [scope, setScope] = useState<VisibilityScope>('version');
  const target = targetVisibility.toLowerCase();

  const options: { value: VisibilityScope; title: string; description: string }[] = [
    {
      value: 'version',
      title: `Only version ${versionLabel}`,
      description: 'The other versions keep their current visibility.',
    },
    {
      value: 'pricing',
      title: `All ${versionCount} versions`,
      description: `Every version of this pricing becomes ${target}.`,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-[28rem] cursor-default rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-2 text-center font-display text-lg font-semibold text-tp-ink">Make {target}</h2>
        <p className="mb-4 text-center text-sm text-tp-steel">Choose what this change applies to.</p>

        <fieldset className="flex flex-col gap-2">
          {options.map(option => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                scope === option.value ? 'border-tp-primary bg-tp-primary/5' : 'border-tp-hairline hover:bg-tp-surface'
              }`}
            >
              <input
                type="radio"
                name="visibility-scope"
                value={option.value}
                checked={scope === option.value}
                onChange={() => setScope(option.value)}
                className="mt-0.5 h-4 w-4 cursor-pointer"
              />
              <span>
                <span className="block text-sm font-medium text-tp-ink">{option.title}</span>
                <span className="block text-xs text-tp-steel">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-xs font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => onConfirm(scope)}
            className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-40"
          >
            {isSubmitting ? 'Saving…' : `Make ${target}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
