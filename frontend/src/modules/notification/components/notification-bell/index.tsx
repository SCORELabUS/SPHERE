import { useState, useRef, useEffect } from 'react';
import Iconify from '../../../core/components/iconify';
import { useNotificationsContext } from '../../hooks/useNotificationsContext';
import NotificationDropdown from '../notification-dropdown';

export default function NotificationBell() {
  const { unreadCount } = useNotificationsContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isRinging, setIsRinging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(unreadCount);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (unreadCount > prevCountRef.current) {
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
      setIsRinging(true);
      ringTimerRef.current = setTimeout(() => setIsRinging(false), 700);
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    return () => {
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const hasUnread = unreadCount > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative cursor-pointer rounded-lg border p-1.5 transition-colors ${
          hasUnread
            ? 'border-tp-primary/30 bg-tp-primary/10 text-tp-primary hover:bg-tp-primary/20'
            : 'border-tp-hairline-soft bg-tp-canvas text-tp-steel hover:text-tp-ink'
        }`}
        title="Notifications"
      >
        <span className={isRinging ? 'animate-bell-ring inline-block' : 'inline-block'}>
          <Iconify icon={hasUnread ? 'mdi:bell-badge-outline' : 'mdi:bell-outline'} width={18} />
        </span>
        {hasUnread && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-tp-primary px-1 text-[10px] font-medium text-tp-on-primary">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && <NotificationDropdown onClose={() => setIsOpen(false)} />}
    </div>
  );
}
