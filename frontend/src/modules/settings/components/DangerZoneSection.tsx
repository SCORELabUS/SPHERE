import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiAlertTriangle, FiLoader, FiShield, FiTrash2, FiX } from 'react-icons/fi';
import { useAuth } from '../../auth/hooks/useAuth';
import { useRouter } from '../../core/hooks/useRouter';
import { useUserSettingsApi } from '../api/userSettingsApi';

export default function DangerZoneSection() {
  const { authUser, logout } = useAuth();
  const router = useRouter();
  const api = useUserSettingsApi();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const username = authUser.user?.username ?? '';
  const isConfirmed = confirmText === username;

  const closeModal = () => {
    if (deleting) return;
    setShowConfirm(false);
    setError(null);
    setConfirmText('');
  };

  const confirmDelete = async () => {
    if (!authUser.user || !isConfirmed) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount(authUser.user.username);
      logout();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
    }
  };

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

      {/* Confirmation modal — portaled to <body> so it isn't clipped by an ancestor
          motion.div: Framer Motion sets an inline transform on the settings tab's
          animated wrapper, which creates a new containing block for this dialog's
          position: fixed and shrinks it to that wrapper's box instead of the viewport. */}
      {createPortal(
        <AnimatePresence>
          {showConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
              onClick={closeModal}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 12 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="w-full max-w-100 overflow-hidden rounded-[12px] border border-tp-hairline bg-tp-canvas shadow-elevation-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-tp-hairline px-5 py-4">
                  <h3 className="text-base font-medium text-tp-ink">
                    Confirm Deletion
                  </h3>
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={deleting}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-50"
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

                  <div className="mt-4">
                    <label htmlFor="delete-confirm-username" className="block text-xs font-medium text-tp-steel">
                      Type <span className="font-semibold text-tp-ink">{username}</span> to confirm
                    </label>
                    <input
                      id="delete-confirm-username"
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      disabled={deleting}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder={username}
                      className="mt-1.5 h-10 w-full rounded-md border border-tp-input-border bg-tp-input-bg px-3 text-sm text-tp-ink outline-none transition-colors focus:border-red-400 focus:ring-1 focus:ring-red-400/30 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      role="alert"
                      className="mt-4 flex items-start gap-2 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
                    >
                      <FiShield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{error}</span>
                    </motion.div>
                  )}

                  <div className="mt-6 flex justify-end gap-2">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={closeModal}
                      disabled={deleting}
                      className="cursor-pointer rounded-[8px] px-4 py-2.5 text-sm font-medium text-tp-steel transition-colors hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={confirmDelete}
                      disabled={deleting || !isConfirmed}
                      className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deleting ? <FiLoader className="h-4 w-4 animate-spin" /> : <FiTrash2 className="h-4 w-4" />}
                      {deleting ? 'Deleting…' : 'Delete Account'}
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
