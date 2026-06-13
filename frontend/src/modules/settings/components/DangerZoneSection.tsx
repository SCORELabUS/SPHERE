import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiAlertTriangle, FiTrash2, FiX } from 'react-icons/fi';

export default function DangerZoneSection() {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-tp-ink">Danger Zone</h2>
        <p className="mt-0.5 text-sm text-tp-steel">
          Irreversible actions on your account
        </p>
      </div>

      <div className="rounded-[12px] border border-red-200 bg-tp-canvas p-6 dark:border-red-500/20">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-red-50 dark:bg-red-500/10">
            <FiAlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-tp-ink">
              Delete Account
            </h3>
            <p className="mt-1 text-sm text-tp-steel">
              Permanently delete your account. This action is irreversible and
              you will lose all your data, history, and subscription.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => setShowConfirm(true)}
              className="mt-4 flex cursor-pointer items-center gap-2 rounded-[8px] border border-red-300 bg-tp-canvas px-4 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
            >
              <FiTrash2 className="h-4 w-4" />
              Delete My Account
            </motion.button>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setShowConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="w-full max-w-md overflow-hidden rounded-[12px] border border-tp-hairline bg-tp-canvas shadow-elevation-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-tp-hairline px-5 py-4">
                <h3 className="text-base font-medium text-tp-ink">
                  Confirm Deletion
                </h3>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                >
                  <FiX className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-red-50 dark:bg-red-500/10">
                    <FiAlertTriangle className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm text-tp-ink">
                      Are you sure you want to delete your account? This action is irreversible.
                    </p>
                    <p className="mt-2 text-sm text-tp-steel">
                      You will lose all your data, payment history, subscription, and settings.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={() => setShowConfirm(false)}
                    className="cursor-pointer rounded-[8px] px-4 py-2.5 text-sm font-medium text-tp-steel transition-colors hover:text-tp-ink"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled
                    className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-red-500 px-4 py-2.5 text-sm font-medium text-white opacity-50 cursor-not-allowed"
                  >
                    <FiTrash2 className="h-4 w-4" />
                    Delete Account
                  </motion.button>
                </div>
                <p className="mt-3 text-center text-xs text-tp-steel">
                  This feature will be available in a future version.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
