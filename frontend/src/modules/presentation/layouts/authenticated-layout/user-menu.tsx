import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../../auth/hooks/useAuth';
import { useRouter } from '../../../core/hooks/useRouter';
import { dropdownVariants, transitionFast } from '../../../core/utils/motion-variants';
import Avatar from '../../../core/components/avatar';
import { FaKey } from "react-icons/fa";
import Iconify from '../../../core/components/iconify';
import { useNotificationsContext } from '../../../notification/hooks/useNotificationsContext';

export default function UserMenu() {
  const { authUser, logout } = useAuth();
  const router = useRouter();
  const { unreadCount } = useNotificationsContext();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const menuItems = [
    {
      label: 'Inbox',
      icon: <Iconify icon="mdi:inbox" className="h-4 w-4" />,
      onClick: () => {
        router.push('/notifications');
        setIsOpen(false);
      },
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    {
      label: 'Organizations',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
        </svg>
      ),
      onClick: () => {
        router.push('/me/orgs');
        setIsOpen(false);
      },
    },
    {
      label: 'API Keys',
      icon: <FaKey className="h-4 w-4" />,
      onClick: () => {
        router.push('/me/api-keys');
        setIsOpen(false);
      },
    },
    {
      label: 'Settings',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      onClick: () => {
        router.push('/me/settings');
        setIsOpen(false);
      },
    },
  ];

  const handleLogout = () => {
    logout();
    setIsOpen(false);
    router.push('/');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label="User menu"
        aria-expanded={isOpen}
        className="flex cursor-pointer items-center justify-center overflow-hidden rounded-full border border-tp-hairline bg-tp-cream transition-all hover:ring-2 hover:ring-tp-primary/20"
      >
        <Avatar w={32} h={32} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={transitionFast}
            className="absolute right-0 top-full z-50 mt-2 w-50 origin-top-right rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4"
          >
            <div className="border-b border-tp-hairline px-3 py-2.5">
              <p className="text-sm font-medium text-tp-ink">{authUser.user?.firstName}</p>
              <p className="text-xs text-tp-steel">{authUser.user?.email}</p>
            </div>

            {menuItems.map(item => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
              >
                {item.icon}
                {item.label}
                {item.badge !== undefined && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-tp-primary px-1 text-[10px] font-medium text-tp-on-primary">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </button>
            ))}

            <div className="border-t border-tp-hairline">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                Logout
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
