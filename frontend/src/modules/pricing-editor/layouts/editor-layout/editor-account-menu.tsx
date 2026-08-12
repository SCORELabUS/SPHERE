import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiChevronDown, FiGrid, FiLogOut, FiSettings, FiUsers } from 'react-icons/fi';
import { useAuth } from '../../../auth/hooks/useAuth';
import Avatar from '../../../core/components/avatar';
import { useRouter } from '../../../core/hooks/useRouter';
import { dropdownVariants, transitionFast } from '../../../core/utils/motion-variants';

export default function EditorAccountMenu() {
  const { authUser, logout } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const navigateTo = (path: string) => {
    setIsOpen(false);
    router.push(path);
  };

  const handleLogout = () => {
    logout();
    setIsOpen(false);
    router.push('/');
  };

  const user = authUser.user;
  const displayName = user?.settings?.profile?.displayName
    || [user?.firstName, user?.lastName].filter(Boolean).join(' ')
    || user?.username;

  return (
    <div ref={containerRef} className="relative ml-1 border-l border-white/10 pl-2">
      <button
        type="button"
        onClick={() => setIsOpen(current => !current)}
        aria-label="Editor account menu"
        aria-expanded={isOpen}
        className="flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-left transition-colors hover:bg-white/10"
      >
        <span className="rounded-full ring-1 ring-white/20">
          <Avatar w={28} h={28} />
        </span>
        <span className="hidden max-w-28 truncate text-xs font-medium text-white/80 xl:block">
          {displayName}
        </span>
        <FiChevronDown className={`hidden h-3.5 w-3.5 text-white/40 transition-transform sm:block ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={transitionFast}
            className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-white/10 bg-[#181818] shadow-elevation-4"
          >
            <div className="border-b border-white/10 px-4 py-3">
              <p className="truncate text-sm font-medium text-white">{displayName}</p>
              <p className="mt-0.5 truncate text-xs text-white/45">{user?.email}</p>
            </div>

            <div className="p-1.5">
              <button type="button" onClick={() => navigateTo('/')} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white">
                <FiGrid className="h-4 w-4" />
                Dashboard
              </button>
              <button type="button" onClick={() => navigateTo('/me/orgs')} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white">
                <FiUsers className="h-4 w-4" />
                My organizations
              </button>
              <button type="button" onClick={() => navigateTo('/me/settings')} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white">
                <FiSettings className="h-4 w-4" />
                Account settings
              </button>
            </div>

            <div className="border-t border-white/10 p-1.5">
              <button type="button" onClick={handleLogout} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-white/65 transition-colors hover:bg-red-500/10 hover:text-red-300">
                <FiLogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
