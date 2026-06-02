import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '../../../../auth/hooks/useAuth';
import Avatar from '../../../../core/components/avatar';
import type { NavItem } from '../data';

type Props = {
  navItems: NavItem[];
  onNavigate: (to: string) => void;
};

export default function FloatingMorphHeader({ navItems, onNavigate }: Props) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDesktopDropdown, setOpenDesktopDropdown] = useState<string | null>(null);
  const [openMobileDropdown, setOpenMobileDropdown] = useState<string | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const headerMorphRef = useRef<HTMLDivElement | null>(null);
  const userMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const headerMorphTargetRef = useRef(0);
  const headerMorphCurrentRef = useRef(0);
  const headerMorphRafRef = useRef(0);
  const { authUser, logout } = useAuth();

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? 'hidden' : '';

    return () => {
      document.body.style.overflow = '';
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!userMenuContainerRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isUserMenuOpen]);

  useEffect(() => {
    const applyMorph = (value: number) => {
      if (!headerMorphRef.current) {
        return;
      }

      headerMorphRef.current.style.setProperty('--header-morph', value.toFixed(4));
    };

    const animateMorph = () => {
      const current = headerMorphCurrentRef.current;
      const target = headerMorphTargetRef.current;
      const next = current + (target - current) * 0.24;
      const isSettled = Math.abs(target - next) < 0.0015;
      const finalValue = isSettled ? target : next;

      headerMorphCurrentRef.current = finalValue;
      applyMorph(finalValue);

      if (!isSettled) {
        headerMorphRafRef.current = window.requestAnimationFrame(animateMorph);
        return;
      }

      headerMorphRafRef.current = 0;
    };

    const scheduleMorph = () => {
      if (headerMorphRafRef.current !== 0) {
        return;
      }

      headerMorphRafRef.current = window.requestAnimationFrame(animateMorph);
    };

    const updateMorphTarget = () => {
      const progress = Math.min(window.scrollY / 160, 1);
      headerMorphTargetRef.current = progress;
      scheduleMorph();
    };

    applyMorph(0);
    updateMorphTarget();

    window.addEventListener('scroll', updateMorphTarget, { passive: true });
    window.addEventListener('resize', updateMorphTarget, { passive: true });

    return () => {
      if (headerMorphRafRef.current !== 0) {
        window.cancelAnimationFrame(headerMorphRafRef.current);
        headerMorphRafRef.current = 0;
      }

      window.removeEventListener('scroll', updateMorphTarget);
      window.removeEventListener('resize', updateMorphTarget);
    };
  }, []);

  const headerStyle: CSSProperties = {
    ['--header-morph' as string]: 0,
    marginTop: 'calc(24px * (1 - var(--header-morph)))',
    paddingLeft: 'calc(16px * (1 - var(--header-morph)))',
    paddingRight: 'calc(16px * (1 - var(--header-morph)))',
  };

  const barStyle: CSSProperties = {
    maxWidth: 'calc(1080px + (100vw - 1080px) * var(--header-morph))',
    borderRadius: 'calc(9999px * (1 - var(--header-morph)))',
    paddingLeft: 'calc(20px + 12px * var(--header-morph))',
    paddingRight: 'calc(20px + 12px * var(--header-morph))',
    backgroundColor: 'rgb(255 255 255 / calc(0.75 + 0.2 * var(--header-morph)))',
    boxShadow:
      '0 calc(6px + 8px * var(--header-morph)) calc(26px + 18px * var(--header-morph)) rgb(15 23 42 / calc(0.08 + 0.08 * var(--header-morph)))',
    borderBottomWidth: 'calc(1px * var(--header-morph))',
    borderBottomColor: 'rgba(15,23,42,0.1)',
  };

  return (
    <>
      <header ref={headerMorphRef} style={headerStyle} className="fixed inset-x-0 top-0 z-30 flex justify-center will-change-transform">
        <div style={barStyle} className="flex w-full items-center justify-between border border-black/10 py-3 backdrop-blur-3xl">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="cursor-pointer text-sm font-medium tracking-[0.22em] text-[#0f172a] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-black"
          >
            SPHERE
          </button>

          <nav className="hidden items-center gap-3 md:flex">
            {navItems.map(item => (
              <div
                key={item.label}
                className="relative"
                onMouseEnter={() => setOpenDesktopDropdown(item.children ? item.label : null)}
                onMouseLeave={() => setOpenDesktopDropdown(null)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (item.to) {
                      onNavigate(item.to);
                    }
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-[#334155] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-[#0f172a]"
                >
                  {item.label}
                  {item.children ? <span className="text-[11px]">▾</span> : null}
                </button>

                {item.children ? (
                  <div
                    className={`absolute left-0 top-full min-w-55 pt-2 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${openDesktopDropdown === item.label ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'}`}
                  >
                    <div className="rounded-2xl border border-black/10 bg-white p-2 shadow-[0_14px_34px_rgba(15,23,42,0.12)]">
                      {item.children.map(child => (
                        <button
                          key={child.label}
                          type="button"
                          onClick={() => onNavigate(child.to)}
                          className="block w-full cursor-pointer rounded-xl px-3 py-2 text-center text-xs uppercase tracking-[0.12em] text-[#334155] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </nav>

          <div className="hidden md:block">
            {authUser.isAuthenticated ? (
              <div ref={userMenuContainerRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen(prev => !prev)}
                  aria-label="User settings"
                  aria-expanded={isUserMenuOpen}
                  className="overflow-hidden cursor-pointer rounded-full border border-black/15 bg-white"
                >
                  <Avatar w={40} h={40} />
                </button>

                <div
                  className={`absolute right-0 top-full mt-2 w-55 rounded-2xl border border-black/10 bg-white p-2 shadow-[0_14px_34px_rgba(15,23,42,0.12)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isUserMenuOpen ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'}`}
                >
                  <div className="mb-2 rounded-xl border border-black/10 bg-[#fcfcfb] px-3 py-2 text-center">
                    <p className="text-sm font-medium text-[#0f172a]">{authUser.user?.firstName ?? 'User'}</p>
                    <p className="text-xs text-[#64748b]">{authUser.user?.email ?? ''}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      onNavigate('/pricings/new');
                    }}
                    className="block w-full cursor-pointer rounded-xl px-3 py-2 text-center text-xs uppercase tracking-[0.12em] text-[#334155] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                  >
                    New Pricing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      setIsUserMenuOpen(false);
                      onNavigate('/');
                    }}
                    className="mt-1 block w-full cursor-pointer rounded-xl px-3 py-2 text-center text-xs uppercase tracking-[0.12em] text-[#334155] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('/authentication')}
                  className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full border border-black/15 bg-white px-5 text-xs uppercase tracking-[0.14em] text-[#334155] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-[#0f172a]"
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/authentication?view=register')}
                  className="group inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-black/10 bg-[#0f172a] px-5 text-xs uppercase tracking-[0.14em] text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#1e293b] active:scale-[0.98]"
                >
                  Register
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[11px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-px group-hover:translate-x-1">
                    ↗
                  </span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen(prev => !prev)}
            className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] md:hidden"
          >
            <span
              className={`absolute h-px w-5 bg-[#0f172a] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${isMenuOpen ? 'translate-y-0 rotate-45' : '-translate-y-1.25 rotate-0'}`}
            />
            <span
              className={`absolute h-px w-5 bg-[#0f172a] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${isMenuOpen ? 'translate-y-0 -rotate-45' : 'translate-y-1.25 rotate-0'}`}
            />
          </button>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-20 bg-white/85 backdrop-blur-3xl px-4 pt-28 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] md:hidden ${isMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="mx-auto flex w-full max-w-112 flex-col gap-3">
          {navItems.map((item, index) => (
            <div key={item.label} className="rounded-[1.35rem] border border-black/10 bg-white px-5 py-3">
              <button
                type="button"
                style={{ transitionDelay: `${100 + index * 50}ms` }}
                onClick={() => {
                  if (item.children) {
                    setOpenMobileDropdown(prev => (prev === item.label ? null : item.label));
                    return;
                  }

                  if (item.to) {
                    setIsMenuOpen(false);
                    onNavigate(item.to);
                  }
                }}
                className={`flex w-full cursor-pointer items-center justify-between text-left text-sm uppercase tracking-[0.15em] text-[#0f172a] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${isMenuOpen ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
              >
                {item.label}
                {item.children ? <span className="text-[11px]">{openMobileDropdown === item.label ? '▴' : '▾'}</span> : null}
              </button>

              {item.children && openMobileDropdown === item.label ? (
                <div className="mt-3 flex flex-col gap-2">
                  {item.children.map(child => (
                    <button
                      key={child.label}
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onNavigate(child.to);
                      }}
                      className="cursor-pointer rounded-xl border border-black/10 bg-[#f8fafc] px-3 py-2 text-center text-xs uppercase tracking-[0.12em] text-[#334155]"
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          {authUser.isAuthenticated ? (
            <div
              className={`mt-2 rounded-[1.35rem] border border-black/10 bg-white px-5 py-4 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${isMenuOpen ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="overflow-hidden rounded-full border border-black/10 bg-white">
                  <Avatar w={40} h={40} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#0f172a]">{authUser.user?.firstName ?? 'User'}</p>
                  <p className="text-xs text-[#64748b]">{authUser.user?.email ?? ''}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onNavigate('/pricings/new');
                  }}
                  className="rounded-xl border border-black/10 bg-[#f8fafc] px-3 py-2 text-center text-xs uppercase tracking-[0.12em] text-[#334155]"
                >
                  New Pricing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setIsMenuOpen(false);
                    onNavigate('/');
                  }}
                  className="rounded-xl border border-black/10 bg-[#f8fafc] px-3 py-2 text-center text-xs uppercase tracking-[0.12em] text-[#334155]"
                >
                  Logout
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onNavigate('/authentication');
                }}
                className={`inline-flex items-center justify-center cursor-pointer rounded-full border border-black/10 bg-white px-6 py-3 text-sm font-medium text-[#334155] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${isMenuOpen ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onNavigate('/authentication?view=register');
                }}
                className={`inline-flex items-center justify-between cursor-pointer rounded-full border border-black/10 bg-[#0f172a] px-6 py-3 text-sm font-medium text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${isMenuOpen ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}
              >
                Start with SPHERE
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-[13px]">↗</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
