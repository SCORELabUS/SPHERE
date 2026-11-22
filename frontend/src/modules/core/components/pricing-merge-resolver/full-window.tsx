import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A layer over the whole window, above any dialog, for work that needs the
 * room (the merge resolver). The page behind does not scroll while it is open,
 * and Escape closes it, unless something inside took that Escape for itself
 * (the YAML editor's find box or suggestions).
 */
export default function FullWindowLayer({
  label,
  onClose,
  children,
}: {
  /** The accessible name of the layer. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const { body } = document;
    const overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = overflow;
    };
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.stopPropagation();
        close.current();
      }}
      className="fixed inset-0 z-[60] flex bg-tp-ink/60 p-2 sm:p-4"
    >
      <div className="flex h-full w-full min-w-0 flex-col rounded-2xl border border-tp-hairline bg-tp-canvas p-3 shadow-elevation-4 sm:p-5">
        {children}
      </div>
    </div>,
    document.body
  );
}
