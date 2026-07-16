import { useState } from 'react';
import { useRouter } from '../../../core/hooks/useRouter';
import UserMenu from './user-menu';
import MobileNav from './mobile-nav';
import CommandPalette from '../../../core/components/command-palette';
import NotificationBell from '../../../notification/components/notification-bell';
import { FaFileInvoiceDollar, FaFolder } from "react-icons/fa";

const NAV_ITEMS = [
  {
    label: 'Explore',
    children: [
      { label: 'Pricings', to: '/pricings' },
      { label: 'Collections', to: '/collections' },
    ],
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

export default function AppHeader() {
  const router = useRouter();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleNavigate = (to: string) => {
    router.push(to);
    setOpenDropdown(null);
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-tp-hairline bg-tp-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 md:px-6">
          {/* Left: Logo */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleNavigate('/')}
              className="cursor-pointer text-sm font-semibold tracking-[0.22em] text-tp-ink transition-colors hover:text-tp-primary"
            >
              SPHERE
            </button>
          </div>

          {/* Center: Navigation (desktop) */}
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(item => (
              <div
                key={item.label}
                className="relative"
                onMouseEnter={() => setOpenDropdown(item.children ? item.label : null)}
                onMouseLeave={() => setOpenDropdown(null)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (item.to) handleNavigate(item.to);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-3 py-1.5 text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
                >
                  {item.label}
                  {item.children && (
                    <svg
                      className={`h-3.5 w-3.5 text-tp-ink transition-transform ${openDropdown === item.label ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>

                {item.children && (
                  <div
                    className={`absolute left-0 top-full z-50 min-w-50 pt-1 transition-all ${
                      openDropdown === item.label
                        ? 'pointer-events-auto translate-y-0 opacity-100'
                        : 'pointer-events-none -translate-y-1 opacity-0'
                    }`}
                  >
                    <div className="rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4">
                      {item.children.map(child => (
                        <button
                          key={child.to}
                          type="button"
                          onClick={() => handleNavigate(child.to)}
                          className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* Right: Actions */}
          <div className="flex items-center gap-3">
            <div
              className="relative hidden md:block"
              onMouseEnter={() => setOpenDropdown('new')}
              onMouseLeave={() => setOpenDropdown(null)}
            >
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-tp-primary px-3 py-1.5 text-sm font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New
                <svg
                  className={`h-3.5 w-3.5 transition-transform ${openDropdown === 'new' ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <div
                className={`absolute right-0 top-full z-50 min-w-45 pt-1 transition-all ${
                  openDropdown === 'new'
                    ? 'pointer-events-auto translate-y-0 opacity-100'
                    : 'pointer-events-none -translate-y-1 opacity-0'
                }`}
              >
                <div className="rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-elevation-4">
                  <button
                    type="button"
                    onClick={() => handleNavigate('/pricings/new')}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
                  >
                    <FaFileInvoiceDollar className='h-4 w-4'/>
                    Pricing
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigate('/collections/new')}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
                  >
                    <FaFolder className='h-4 w-4' />
                    Collection
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigate('/orgs/new')}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-tp-slate transition-colors hover:bg-tp-surface hover:text-tp-ink"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                    </svg>
                    Organization
                  </button>
                </div>
              </div>
            </div>

            <div className="hidden md:block">
              <CommandPalette />
            </div>

            <div className="hidden md:block">
              <NotificationBell />
            </div>

            <div className="hidden md:block">
              <UserMenu />
            </div>

            {/* Mobile menu button */}
            <button
              type="button"
              aria-label="Toggle navigation"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink md:hidden"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <MobileNav
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
    </>
  );
}
