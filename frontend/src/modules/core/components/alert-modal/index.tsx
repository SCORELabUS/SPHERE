import { motion } from 'framer-motion';
import { MdError, MdWarning, MdInfo, MdCheckCircle } from 'react-icons/md';
import { transitionFast } from '../../utils/motion-variants';

export type Severity = 'error' | 'warning' | 'info' | 'success';
export type SeverityOption = 'error' | 'warning' | 'info' | 'success' | 'auto';

interface AlertModalProps {
  message: string;
  severity?: SeverityOption;
  onClose: () => void;
}

const severityConfig: Record<Severity, {
  icon: typeof MdError;
  borderColor: string;
  iconColor: string;
  bgHover: string;
}> = {
  error: {
    icon: MdError,
    borderColor: 'border-t-tp-severity-error',
    iconColor: 'text-tp-severity-error',
    bgHover: 'hover:bg-tp-severity-error-bg',
  },
  warning: {
    icon: MdWarning,
    borderColor: 'border-t-tp-severity-warning',
    iconColor: 'text-tp-severity-warning',
    bgHover: 'hover:bg-tp-severity-warning-bg',
  },
  info: {
    icon: MdInfo,
    borderColor: 'border-t-tp-severity-info',
    iconColor: 'text-tp-severity-info',
    bgHover: 'hover:bg-tp-severity-info-bg',
  },
  success: {
    icon: MdCheckCircle,
    borderColor: 'border-t-tp-severity-success',
    iconColor: 'text-tp-severity-success',
    bgHover: 'hover:bg-tp-severity-success-bg',
  },
};

const AlertModal = ({ message, severity = 'auto', onClose }: AlertModalProps): JSX.Element => {
  
  if (severity === 'auto') {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('fail')) {
      severity = 'error';
    }else if (lowerMessage.includes('warn')) {
      severity = 'warning';
    }else if (lowerMessage.includes('success')) {
      severity = 'success';
    } else {
      severity = 'info';
    }
  }

  const config = severityConfig[severity];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transitionFast}
      className="fixed inset-0 z-1000 flex cursor-pointer items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={transitionFast}
        onClick={(e) => e.stopPropagation()}
        className={`flex w-[90dvw] max-w-100 flex-col rounded-xl border border-tp-hairline border-t-4 ${config.borderColor} bg-tp-canvas p-6 shadow-elevation-4`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3">
          <Icon className={`h-6 w-6 shrink-0 ${config.iconColor}`} />
          <p className="text-sm leading-relaxed text-tp-ink">{message}</p>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`cursor-pointer rounded-lg border border-tp-hairline-strong bg-tp-surface px-4 py-2 text-sm font-medium text-tp-ink transition ${config.bgHover} hover:border-tp-muted`}
          >
            Aceptar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default AlertModal;
