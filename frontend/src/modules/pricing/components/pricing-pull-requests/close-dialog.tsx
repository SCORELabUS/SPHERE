import { useState } from 'react';
import { motion } from 'framer-motion';
import { PullRequestApiError } from '../../api/pricingPullRequestsApi';
import { pullRequestMessage } from '../../../core/utils/pull-request-state';

/** Longest reason the API keeps. */
const MAX_REASON_LENGTH = 500;

/**
 * Closes a pull request: its author withdraws it, a maintainer rejects it.
 * The optional reason is shown as plain text to whoever sees the pull request.
 */
export default function CloseDialog({
  number,
  withdraw,
  onConfirm,
  onClose,
}: {
  number: number;
  /** The author withdraws their own pull request; anyone else closing it rejects it. */
  withdraw: boolean;
  onConfirm: (reason?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = withdraw ? 'Withdraw' : 'Close';

  const submit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim() || undefined);
    } catch (caught) {
      setError(
        caught instanceof PullRequestApiError
          ? pullRequestMessage(caught.code, { message: caught.message })
          : pullRequestMessage(null)
      );
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
      aria-labelledby="close-pull-request-title"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-[28rem] cursor-default rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
        onClick={event => event.stopPropagation()}
      >
        <h2 id="close-pull-request-title" className="mb-2 font-display text-lg font-semibold text-tp-ink">
          {action} pull request #{number}
        </h2>
        <p className="mb-4 text-sm text-tp-steel">
          {withdraw
            ? 'Your proposal will no longer be reviewed. Pull requests cannot be reopened.'
            : 'The proposal will not be merged and its author will be notified. Pull requests cannot be reopened.'}
        </p>
        <label htmlFor="close-pull-request-reason" className="mb-1 block text-sm font-medium text-tp-slate">
          Reason (optional)
        </label>
        <textarea
          id="close-pull-request-reason"
          value={reason}
          maxLength={MAX_REASON_LENGTH}
          rows={3}
          onChange={event => setReason(event.target.value)}
          className="w-full resize-y rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none focus:border-tp-primary"
        />
        {error && (
          <p role="alert" className="mt-3 text-xs text-tp-severity-error">
            {error}
          </p>
        )}
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
            onClick={submit}
            className="cursor-pointer rounded-lg bg-tp-primary px-4 py-2 text-xs font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep disabled:cursor-default disabled:opacity-50"
          >
            {isSubmitting ? `${action === 'Withdraw' ? 'Withdrawing' : 'Closing'}…` : `${action} pull request`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
