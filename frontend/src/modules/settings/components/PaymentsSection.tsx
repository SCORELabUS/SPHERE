import { motion } from 'framer-motion';
import { FiCreditCard, FiExternalLink } from 'react-icons/fi';
import type { UserSettings } from '../api/userSettingsApi';

interface Props {
  settings: UserSettings;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function PaymentsSection({ settings: _settings }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-tp-ink">Payments & Subscription</h2>
        <p className="mt-0.5 text-sm text-tp-steel">
          Manage your subscription and view payment history
        </p>
      </div>

      {/* Subscription status */}
      <div className="rounded-[12px] border border-tp-hairline bg-tp-canvas p-6">
        <h3 className="text-sm font-medium text-tp-ink">Subscription Status</h3>
        <div className="mt-4 flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-tp-primary/10">
            <FiCreditCard className="h-6 w-6 text-tp-primary" />
          </div>
          <div className="flex-1">
            <span className="inline-flex items-center rounded-full bg-tp-surface px-2.5 py-0.5 text-xs font-medium text-tp-steel">
              No active subscription
            </span>
            <p className="mt-2 text-sm text-tp-steel">
              You don&apos;t have an active subscription at this time.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-tp-hairline-strong bg-tp-canvas px-4 py-2.5 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            Manage Subscription
            <FiExternalLink className="h-3.5 w-3.5" />
          </motion.button>
        </div>
      </div>

      {/* Payment history */}
      <div className="rounded-[12px] border border-tp-hairline bg-tp-canvas">
        <div className="border-b border-tp-hairline px-6 py-4">
          <h3 className="text-sm font-medium text-tp-ink">Payment History</h3>
        </div>
        <div className="px-6 py-10 text-center">
          <FiCreditCard className="mx-auto mb-3 h-8 w-8 text-tp-hairline-strong" />
          <p className="text-sm text-tp-steel">No payments recorded</p>
        </div>
      </div>

      {/* Payment method placeholder */}
      <div className="rounded-[12px] border border-tp-hairline bg-tp-canvas p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-tp-ink">Payment Method</h3>
            <p className="mt-1 text-sm text-tp-steel">
              Set up your payment method
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            className="cursor-pointer rounded-[8px] border border-tp-hairline-strong bg-tp-canvas px-4 py-2.5 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            Configure
          </motion.button>
        </div>
      </div>
    </div>
  );
}
