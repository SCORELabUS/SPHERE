import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { dropdownVariants, transitionFast } from '../../../core/utils/motion-variants';
import { useNotificationsContext } from '../../hooks/useNotificationsContext';
import NotificationItem from '../notification-item';

interface NotificationDropdownProps {
  onClose: () => void;
}

export default function NotificationDropdown({ onClose }: NotificationDropdownProps) {
  const { notifications, unreadCount, isLoading, fetchNotifications, markAllAsRead } = useNotificationsContext();
  const navigate = useNavigate();

  useEffect(() => {
    fetchNotifications({ limit: 10 });
  }, [fetchNotifications]);

  const handleViewAll = () => {
    navigate('/notifications');
    onClose();
  };

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={dropdownVariants}
      transition={transitionFast}
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-tp-hairline bg-tp-canvas shadow-elevation-4"
    >
      <div className="flex items-center justify-between border-b border-tp-hairline px-4 py-3">
        <h3 className="font-display text-sm font-medium text-tp-ink">Notifications</h3>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllAsRead()}
            className="cursor-pointer text-xs text-tp-primary transition-colors hover:text-tp-primary-deep"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {isLoading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-tp-primary border-t-transparent" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-tp-steel">No notifications yet</p>
          </div>
        ) : (
          <div className="py-1">
            {notifications.slice(0, 10).map((notification) => (
              <NotificationItem key={notification.id} notification={notification} onClose={onClose} />
            ))}
          </div>
        )}
      </div>

      {notifications.length > 0 && (
        <div className="border-t border-tp-hairline px-4 py-2">
          <button
            onClick={handleViewAll}
            className="w-full cursor-pointer text-center text-xs font-medium text-tp-primary transition-colors hover:text-tp-primary-deep"
          >
            View all notifications
          </button>
        </div>
      )}
    </motion.div>
  );
}
