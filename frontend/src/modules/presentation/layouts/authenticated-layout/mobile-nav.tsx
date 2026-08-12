import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from '../../../core/hooks/useRouter';
import { useAuth } from '../../../auth/hooks/useAuth';
import { staggerContainer, menuItemVariants, transitionFast } from '../../../core/utils/motion-variants';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_STRUCTURE = [
  {
    label: 'Explore',
    children: [
      { label: 'Organizations', to: '/organizations' },
      { label: 'Pricings', to: '/pricings' },
      { label: 'Collections', to: '/collections' },
    ],
  },
  {
    label: 'Organizations',
    to: '/me/orgs',
  },
  {
    label: 'Tools',
    children: [
      { label: 'Pricing2Yaml Editor', to: '/editor' },
      { label: 'HARVEY', to: '/harvey' },
    ],
  },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Team', to: '/team' },
  { label: 'Research', to: '/research' },
];

export default function MobileNav({ isOpen, onClose }: Props) {
  const router = useRouter();
  const { authUser, logout } = useAuth();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const handleNavigate = (to: string) => {
    router.push(to);
    onClose();
  };

  const handleLogout = () => {
    logout();
    onClose();
    router.push('/');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 cursor-pointer bg-tp-ink/20 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 right-0 top-0 z-50 w-75 bg-tp-canvas shadow-elevation-4"
          >
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-tp-hairline px-4 py-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tracking-[0.22em] text-tp-ink">SPHERE</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* User info */}
              {authUser.isAuthenticated && (
                <div className="border-b border-tp-hairline px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-tp-cream text-sm font-semibold text-tp-primary">
                      {authUser.user?.firstName?.[0]?.toUpperCase() ?? 'U'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-tp-ink">{authUser.user?.firstName}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Nav items */}
              <motion.nav
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="flex-1 overflow-y-auto px-3 py-4"
              >
                {NAV_STRUCTURE.map(item => (
                  <motion.div key={item.label} variants={menuItemVariants} transition={transitionFast}>
                    {item.children ? (
                      <div className="mb-1">
                        <button
                          type="button"
                          onClick={() => setExpandedGroup(prev => prev === item.label ? null : item.label)}
                          className="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                        >
                          {item.label}
                          <svg
                            className={`h-4 w-4 text-tp-steel transition-transform ${expandedGroup === item.label ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <AnimatePresence>
                          {expandedGroup === item.label && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="ml-3 border-l border-tp-hairline py-1 pl-3">
                                {item.children.map(child => (
                                  <button
                                    key={child.to}
                                    type="button"
                                    onClick={() => handleNavigate(child.to)}
                                    className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
                                  >
                                    {child.label}
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleNavigate(item.to!)}
                        className="mb-1 block w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                      >
                        {item.label}
                      </button>
                    )}
                  </motion.div>
                ))}
              </motion.nav>

              {/* Footer actions */}
              <div className="border-t border-tp-hairline px-3 py-3">
                <p className="mb-2 px-1 text-xs font-medium text-tp-steel">Create new</p>
                <button
                  type="button"
                  onClick={() => handleNavigate('/pricings/new')}
                  className="mb-1.5 flex w-full cursor-pointer items-center gap-2 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Pricing
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('/collections/new')}
                  className="mb-1.5 flex w-full cursor-pointer items-center gap-2 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  Collection
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('/orgs/new')}
                  className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-ink transition-colors hover:bg-tp-surface"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                  Organization
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full cursor-pointer items-center justify-center rounded-lg px-4 py-2.5 text-sm text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                >
                  Logout
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
