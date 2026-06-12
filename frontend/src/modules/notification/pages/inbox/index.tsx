import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Iconify from '../../../core/components/iconify';
import { useNotificationsContext } from '../../hooks/useNotificationsContext';
import { Notification } from '../../api/notificationsApi';

const kindLabels: Record<string, string> = {
  OrganizationInvitation: 'Organization Invitations',
  System: 'System',
  CollectionShared: 'Collections',
  PricingUpdated: 'Pricing Updates',
};

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

export default function InboxPage() {
  const { notifications, isLoading, fetchNotifications, markAsRead, markAllAsRead, unreadCount } =
    useNotificationsContext();
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  useEffect(() => {
    fetchNotifications({ unreadOnly: showUnreadOnly, limit: 50 });
  }, [fetchNotifications, showUnreadOnly]);

  const filteredNotifications =
    activeFilter === 'all' ? notifications : notifications.filter((n) => n.kind === activeFilter);

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);

      if (notification.kind === 'OrganizationInvitation' && notification.data?.invitationCode) {
        navigate(`/orgs/join/${notification.data.invitationCode}`);
      }
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-tp-ink">Notifications</h1>
          <p className="mt-1 text-sm text-tp-steel">
            {unreadCount > 0 ? `You have ${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up!'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllAsRead()}
            className="cursor-pointer rounded-lg border border-tp-hairline-soft px-3 py-2 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveFilter('all')}
          className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeFilter === 'all'
              ? 'bg-tp-primary text-tp-on-primary'
              : 'border border-tp-hairline-soft text-tp-steel hover:bg-tp-surface'
          }`}
        >
          All
        </button>
        {Object.entries(kindLabels).map(([kind, label]) => (
          <button
            key={kind}
            onClick={() => setActiveFilter(kind)}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeFilter === kind
                ? 'bg-tp-primary text-tp-on-primary'
                : 'border border-tp-hairline-soft text-tp-steel hover:bg-tp-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-tp-steel">
          <input
            type="checkbox"
            checked={showUnreadOnly}
            onChange={(e) => setShowUnreadOnly(e.target.checked)}
            className="h-4 w-4 rounded border-tp-hairline text-tp-primary focus:ring-tp-primary"
          />
          Show unread only
        </label>
      </div>

      <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas">
        {isLoading && filteredNotifications.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-tp-primary border-t-transparent" />
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="py-12 text-center">
            <Iconify icon="mdi:bell-off" width={48} className="mx-auto text-tp-muted" />
            <p className="mt-4 text-sm text-tp-steel">No notifications found</p>
          </div>
        ) : (
          <div className="divide-y divide-tp-hairline-soft">
            {filteredNotifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`flex w-full items-start gap-4 p-4 text-left transition-colors ${
                  notification.read ? 'cursor-default' : 'cursor-pointer hover:bg-tp-surface bg-tp-surface/50'
                }`}
              >
                <div
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    notification.read ? 'bg-tp-surface' : 'bg-tp-primary/10'
                  }`}
                >
                  <Iconify
                    icon={kindIcons[notification.kind] || 'mdi:bell'}
                    width={20}
                    className={notification.read ? 'text-tp-steel' : 'text-tp-primary'}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${!notification.read ? 'font-medium text-tp-ink' : 'text-tp-slate'}`}>
                      {notification.title}
                    </p>
                    <div className="flex items-center gap-2">
                      {!notification.read && <span className="h-2 w-2 shrink-0 rounded-full bg-tp-primary" />}
                      <span className="text-[10px] text-tp-muted">{timeAgo(notification.createdAt)}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-tp-steel">{notification.message}</p>
                  {notification.kind === 'OrganizationInvitation' && notification.data?.organizationName && (
                    <p className="mt-2 text-xs text-tp-muted">
                      Organization: {notification.data.organizationName}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
