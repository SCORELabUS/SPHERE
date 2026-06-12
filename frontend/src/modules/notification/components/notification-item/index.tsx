import { useNavigate } from 'react-router-dom';
import Iconify from '../../../core/components/iconify';
import { useNotificationsContext } from '../../hooks/useNotificationsContext';
import { Notification } from '../../api/notificationsApi';

interface NotificationItemProps {
  notification: Notification;
  onClose: () => void;
}

const kindIcons: Record<string, string> = {
  OrganizationInvitation: 'mdi:account-plus',
  System: 'mdi:information',
  CollectionShared: 'mdi:folder-shared',
  PricingUpdated: 'mdi:file-replace',
};

function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationItem({ notification, onClose }: NotificationItemProps) {
  const { markAsRead } = useNotificationsContext();
  const navigate = useNavigate();

  const handleClick = async () => {
    if (!notification.read) {
      await markAsRead(notification.id);

      if (notification.kind === 'OrganizationInvitation' && notification.data?.invitationCode) {
        navigate(`/orgs/join/${notification.data.invitationCode}`);
      }
    }

    onClose();
  };

  return (
    <button
      onClick={handleClick}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
        notification.read ? 'cursor-default' : 'cursor-pointer hover:bg-tp-surface bg-tp-surface/50'
      }`}
    >
      <div
        className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
          notification.read ? 'bg-tp-surface' : 'bg-tp-primary/10'
        }`}
      >
        <Iconify
          icon={kindIcons[notification.kind] || 'mdi:bell'}
          width={16}
          className={notification.read ? 'text-tp-steel' : 'text-tp-primary'}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm ${!notification.read ? 'font-medium text-tp-ink' : 'text-tp-slate'}`}>
            {notification.title}
          </p>
          {!notification.read && (
            <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-tp-primary" />
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-tp-steel">{notification.message}</p>
        <p className="mt-1 text-[10px] text-tp-muted">{timeAgo(notification.createdAt)}</p>
      </div>
    </button>
  );
}
