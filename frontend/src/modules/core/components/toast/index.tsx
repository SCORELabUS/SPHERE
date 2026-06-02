import { useEffect, useState } from 'react';
import Iconify from '../iconify';
import { Notification } from '../../../notification/api/notificationsApi';

export interface Toast {
  id: string;
  notification: Notification;
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
  duration?: number;
}

const kindConfig: Record<string, { icon: string; bgClass: string; borderClass: string; textClass: string; iconClass: string }> = {
  OrganizationInvitation: {
    icon: 'mdi:account-plus',
    bgClass: 'bg-tp-primary/10',
    borderClass: 'border-tp-primary/30',
    textClass: 'text-tp-primary',
    iconClass: 'text-tp-primary',
  },
  System: {
    icon: 'mdi:information',
    bgClass: 'bg-tp-severity-info-bg',
    borderClass: 'border-tp-severity-info-border',
    textClass: 'text-tp-severity-info',
    iconClass: 'text-tp-severity-info',
  },
  CollectionShared: {
    icon: 'mdi:folder-shared',
    bgClass: 'bg-tp-severity-success-bg',
    borderClass: 'border-tp-severity-success-border',
    textClass: 'text-tp-severity-success',
    iconClass: 'text-tp-severity-success',
  },
  PricingUpdated: {
    icon: 'mdi:file-replace',
    bgClass: 'bg-tp-severity-warning-bg',
    borderClass: 'border-tp-severity-warning-border',
    textClass: 'text-tp-severity-warning',
    iconClass: 'text-tp-severity-warning',
  },
};

const defaultConfig = {
  icon: 'mdi:bell',
  bgClass: 'bg-tp-surface',
  borderClass: 'border-tp-hairline',
  textClass: 'text-tp-steel',
  iconClass: 'text-tp-steel',
};

const TOAST_DURATION = 5000;

export default function ToastItem({ toast, onRemove, duration = TOAST_DURATION }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);
  const config = kindConfig[toast.notification.kind] || defaultConfig;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onRemove(toast.id), 250);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, duration, onRemove]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 250);
  };

  return (
    <div
      className={`pointer-events-auto w-80 overflow-hidden rounded-lg border ${config.borderClass} ${config.bgClass} shadow-elevation-4 ${
        isExiting ? 'animate-toast-slide-out' : 'animate-toast-slide-in'
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${config.bgClass}`}>
          <Iconify icon={config.icon} width={14} className={config.iconClass} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${config.textClass}`}>
            {toast.notification.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-tp-steel">
            {toast.notification.message}
          </p>
        </div>
        <button
          onClick={handleClose}
          className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded text-tp-muted transition-colors hover:text-tp-ink"
        >
          <Iconify icon="mdi:close" width={14} />
        </button>
      </div>
    </div>
  );
}
