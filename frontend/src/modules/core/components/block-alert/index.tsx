import { useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MdError, MdWarning, MdInfo, MdCheckCircle, MdClose } from 'react-icons/md';

type AlertVariant = 'error' | 'success' | 'info' | 'warning';

const variantStyles: Record<AlertVariant, string> = {
  error:
    'border-tp-severity-error-border bg-tp-severity-error-bg text-tp-severity-error',
  success:
    'border-tp-severity-success-border bg-tp-severity-success-bg text-tp-severity-success',
  info:
    'border-tp-severity-info-border bg-tp-severity-info-bg text-tp-severity-info',
  warning:
    'border-tp-severity-warning-border bg-tp-severity-warning-bg text-tp-severity-warning',
};

const icons = {
  error: MdError,
  success: MdCheckCircle,
  info: MdInfo,
  warning: MdWarning,
};

export interface BlockAlertProps {
  variant?: AlertVariant;
  message?: ReactNode;
  children?: ReactNode;
  className?: string;
  onDismiss?: () => void;
}

export default function BlockAlert({
  variant = 'error',
  message,
  children,
  className = '',
  onDismiss,
}: BlockAlertProps) {
  const Icon = icons[variant];
  const content = message ?? children;
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = () => {
    setIsExiting(true);
  };

  const handleAnimationComplete = () => {
    onDismiss?.();
  };

  return (
    <AnimatePresence>
      {content && !isExiting && (
        <motion.div
          key="block-alert"
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -6, height: 0 }}
          className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm text-justify ${variantStyles[variant]} ${className}`}
        >
          <Icon className="mt-px shrink-0" />
          <span className="flex-1">{content}</span>
          {onDismiss && (
            <button
              type="button"
              onClick={handleDismiss}
              className="ml-1 shrink-0 cursor-pointer rounded p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Cerrar aviso"
            >
              <MdClose className="h-4 w-4" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
