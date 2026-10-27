import { useState, useRef, useEffect } from 'react';
import Iconify from '../../../core/components/iconify';
import { useNotificationsContext } from '../../hooks/useNotificationsContext';
import NotificationDropdown from '../notification-dropdown';

export default function NotificationBell() {
  const { unreadCount, hasUnseen, markSeen } = useNotificationsContext();
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


  return (
    <div ref={containerRef} className="relative flex items-center justify-center">
      <button
        onClick={() => {
          if (!isOpen) markSeen();
          setIsOpen(!isOpen);
        }}
        className={`relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors ${
          hasUnseen ? 'text-tp-primary' : 'text-tp-steel hover:text-tp-ink'
        }`}
        title={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-label={hasUnseen ? 'Notifications, new unread notifications' : 'Notifications'}
      >
        <span className={isRinging ? 'animate-bell-ring inline-block' : 'inline-block'}>
          <Iconify icon="mdi:bell-outline" width={18} />
        </span>
        {hasUnseen && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-tp-primary ring-2 ring-tp-canvas"
          />
        )}
      </button>

      {isOpen && <NotificationDropdown onClose={() => setIsOpen(false)} />}
    </div>
  );
}
