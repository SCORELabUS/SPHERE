import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Iconify from '../../../../core/components/iconify';
import { Organization } from '../../../api/organizationsApi';

interface Props {
  org: Organization;
}

/**
 * Hands the organization's public page to someone else.
 *
 * Where the browser has the Web Share API — phones, and most modern browsers in
 * a secure context — tapping Share opens the operating system's own share sheet,
 * so the viewer picks WhatsApp, Teams, mail or anything else they have installed,
 * no list of ours to keep in step with theirs. Where it does not — desktop
 * Firefox, or anything served over plain HTTP, where `navigator.share` is not
 * even defined — the same button opens a small menu that works everywhere:
 * copy the link, or hand it to WhatsApp / Teams / email through a plain link.
 *
 * Every destination is the same URL; the organization page reads without an
 * account, so there is nothing to generate or revoke here.
 */
export default function ShareOrgMenu({ org }: Props) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const shareUrl = `${window.location.origin}/orgs/${org.id}`;
  const message = `Take a look at ${org.displayName} on SPHERE`;

  const nativeShare = {
    title: org.displayName,
    text: message,
    url: shareUrl,
  };
  // `navigator.share` is absent outside a secure context and on desktops without
  // an OS share target, so it is feature-detected rather than assumed.
  const canShareNatively =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' || navigator.canShare(nativeShare));

  // The header sits in a banner with overflow:hidden, which would clip an
  // absolutely positioned menu, so the fallback menu is rendered into a portal
  // and pinned to the trigger's viewport rect — right-aligned, as it reads here.
  const positionMenu = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: `${rect.bottom + 8}px`,
      right: `${window.innerWidth - rect.right}px`,
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    positionMenu();

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('resize', positionMenu);
    };
  }, [isMenuOpen, positionMenu]);

  const handleShareClick = useCallback(async () => {
    if (canShareNatively) {
      try {
        await navigator.share(nativeShare);
        return;
      } catch (err) {
        // Dismissing the sheet is the user saying no, not a failure. Anything
        // else — the browser refusing at the last moment — falls through to the
        // menu, which works without the OS.
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    setIsMenuOpen(open => !open);
  }, [canShareNatively]); // eslint-disable-line react-hooks/exhaustive-deps

  // The clipboard is refused outright in insecure contexts and when the page
  // does not hold focus, so a failure here is ordinary rather than exceptional:
  // the menu stays open on its "Copy link" label and the address bar still works.
  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), 2000);
      })
      .catch(() => setHasCopied(false));
  }, [shareUrl]);

  const destinations = [
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      icon: 'mdi:whatsapp',
      href: `https://wa.me/?text=${encodeURIComponent(`${message} ${shareUrl}`)}`,
    },
    {
      key: 'teams',
      label: 'Teams',
      icon: 'mdi:microsoft-teams',
      href: `https://teams.microsoft.com/share?href=${encodeURIComponent(shareUrl)}&msgText=${encodeURIComponent(message)}`,
    },
    {
      key: 'email',
      label: 'Email',
      icon: 'mdi:email-outline',
      // mailto is left to the browser: it opens whatever mail client is set up.
      href: `mailto:?subject=${encodeURIComponent(org.displayName)}&body=${encodeURIComponent(`${message}\n\n${shareUrl}`)}`,
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleShareClick}
        aria-haspopup={canShareNatively ? undefined : 'menu'}
        aria-expanded={canShareNatively ? undefined : isMenuOpen}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-slate transition-colors hover:border-tp-hairline hover:bg-tp-surface hover:text-tp-ink"
      >
        <Iconify icon="mdi:share-variant" width={15} />
        Share
      </button>

      {createPortal(
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              ref={menuRef}
              role="menu"
              style={menuStyle}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="w-56 overflow-hidden rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-(--shadow-elevation-3)"
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleCopy}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-tp-ink transition-colors hover:bg-tp-surface"
              >
                <Iconify
                  icon={hasCopied ? 'mdi:check' : 'mdi:content-copy'}
                  width={16}
                  className={hasCopied ? 'text-green-600' : 'text-tp-steel'}
                />
                {hasCopied ? 'Link copied' : 'Copy link'}
              </button>

              <div className="my-1 h-px bg-tp-hairline" />

              {destinations.map(destination => (
                <a
                  key={destination.key}
                  role="menuitem"
                  href={destination.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-tp-ink transition-colors hover:bg-tp-surface"
                >
                  <Iconify icon={destination.icon} width={16} className="text-tp-steel" />
                  {destination.label}
                </a>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
