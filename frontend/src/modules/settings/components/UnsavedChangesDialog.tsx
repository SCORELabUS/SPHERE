import { motion, AnimatePresence } from 'framer-motion';
import { FiAlertTriangle } from 'react-icons/fi';

interface Props {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
}

export default function UnsavedChangesDialog({ open, onDiscard, onCancel }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-tp-ink/50 backdrop-blur-[2px]"
            onClick={onCancel}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-100 overflow-hidden rounded-lg border border-tp-hairline bg-tp-canvas shadow-elevation-4"
          >
            <div className="h-1 w-full bg-linear-to-r from-tp-primary via-tp-sunshine-700 to-tp-sunshine-500" />

            <div className="px-6 pt-5 pb-6">
              <div className="flex items-start gap-4">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-amber-50 to-orange-50 ring-1 ring-amber-200/60 dark:from-amber-900/20 dark:to-orange-900/20 dark:ring-amber-700/30">
                  <FiAlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h3 className="text-[15px] font-semibold text-tp-ink">
                    Unsaved changes
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-tp-steel">
                    You have unsaved modifications in this section. If you leave now, these changes will be permanently lost.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2.5">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={onCancel}
                  className="cursor-pointer rounded-md border border-tp-hairline-strong bg-tp-canvas px-4 py-2 text-[13px] font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                >
                  Stay here
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={onDiscard}
                  className="cursor-pointer rounded-md bg-tp-ink px-4 py-2 text-[13px] font-medium text-tp-on-dark transition-colors hover:bg-tp-charcoal dark:bg-tp-on-dark dark:text-tp-ink dark:hover:bg-tp-ink-tint"
                >
                  Discard changes
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
