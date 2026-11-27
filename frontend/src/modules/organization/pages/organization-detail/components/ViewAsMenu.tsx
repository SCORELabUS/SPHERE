import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Iconify from '../../../../core/components/iconify';

interface Props {
  /** Previews the organization as any plain member. */
  onViewAsMember: () => void;
  onViewAsVisitor: () => void;
}

/**
 * Lets an owner or admin see their organization as someone else does: as a
 * member first, since that is what they most often need to check, or as a
 * visitor. A member preview starts as any plain member (no permission of their
 * own, so the organization needs no member for it); one member in particular
 * can then be picked from the banner the preview shows.
 */
export default function ViewAsMenu({ onViewAsMember, onViewAsVisitor }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The header clips anything absolutely positioned inside it (overflow:hidden),
  // so the menu goes into a portal pinned under the trigger, as Share's does.
  const positionMenu = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: `${rect.bottom + 8}px`,
      right: `${Math.max(window.innerWidth - rect.right, 8)}px`,
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    positionMenu();
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
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
  }, [isOpen, positionMenu]);

  const choose = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  const item = 'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(open => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="View as"
        title="See this organization as one of its members or a visitor does"
        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tp-hairline-strong bg-tp-canvas px-3 py-2 text-sm font-medium text-tp-slate transition-colors hover:border-tp-hairline hover:bg-tp-surface hover:text-tp-ink"
      >
        <Iconify icon="mdi:eye-outline" width={15} />
        <span className="hidden sm:inline">View as</span>
        <Iconify icon="mdi:chevron-down" width={14} />
      </button>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              ref={menuRef}
              role="menu"
              style={menuStyle}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="w-64 overflow-hidden rounded-lg border border-tp-hairline bg-tp-canvas py-1 shadow-(--shadow-elevation-3)"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onViewAsMember)}
                className={`${item} cursor-pointer hover:bg-tp-surface`}
              >
                <Iconify icon="mdi:account-outline" width={18} className="mt-0.5 shrink-0 text-tp-steel" />
                <span>
                  <span className="block text-sm font-medium text-tp-ink">Member</span>
                  <span className="block text-xs text-tp-steel">What any of its members sees</span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onViewAsVisitor)}
                className={`${item} cursor-pointer hover:bg-tp-surface`}
              >
                <Iconify icon="mdi:earth" width={18} className="mt-0.5 shrink-0 text-tp-steel" />
                <span>
                  <span className="block text-sm font-medium text-tp-ink">Visitor</span>
                  <span className="block text-xs text-tp-steel">What anyone outside it sees</span>
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
