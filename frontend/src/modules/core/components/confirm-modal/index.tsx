import { motion } from 'framer-motion';
import { MdWarning } from 'react-icons/md';
import { transitionFast } from '../../utils/motion-variants';

interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

const ConfirmModal = ({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}: ConfirmModalProps): JSX.Element => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transitionFast}
      className="fixed inset-0 z-1000 flex cursor-pointer items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
      onClick={onCancel}
      role="presentation"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={transitionFast}
        onClick={(e) => e.stopPropagation()}
        className={`flex w-[90dvw] max-w-150 flex-col rounded-xl border border-tp-hairline ${danger ? 'border-t-4 border-t-tp-severity-error' : ''} bg-tp-canvas p-6 shadow-elevation-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
      >
        {danger && (
          <div className="mb-3 flex items-center gap-2">
            <MdWarning className="h-5 w-5 text-tp-severity-error" />
            <span className="text-xs font-semibold uppercase tracking-wide text-tp-severity-error">
              WARNING
            </span>
          </div>
        )}
        <p id="confirm-dialog-message" className="text-sm leading-relaxed text-tp-ink">
          {message}
        </p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-surface px-4 py-2 text-sm font-medium text-tp-ink transition hover:border-tp-muted hover:bg-tp-cream-light"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-white transition ${
              danger
                ? 'bg-tp-severity-error hover:bg-red-600'
                : 'bg-tp-primary hover:bg-tp-primary-deep'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ConfirmModal;
