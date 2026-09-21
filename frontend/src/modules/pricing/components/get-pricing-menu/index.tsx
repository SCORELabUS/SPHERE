import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HiOutlineFolderDownload } from 'react-icons/hi';

interface Props {
  pricingId?: string;
  yamlLink?: string;
  onCopyYamlLink: () => void;
  onDownloadCurrent: () => void;
  onDownloadAll: () => Promise<void>;
}

export default function GetPricingMenu({
  pricingId,
  yamlLink,
  onCopyYamlLink,
  onDownloadCurrent,
  onDownloadAll,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!pricingId) return null;
  const permanentLink = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/p/${pricingId}`;

  const copyPermanentLink = async () => {
    try {
      await navigator.clipboard.writeText(permanentLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy permanent link', permanentLink);
    }
  };

  const downloadAll = async () => {
    setDownloading(true);
    try {
      await onDownloadAll();
      setOpen(false);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-300 dark:bg-orange-500 dark:hover:bg-orange-400"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.7}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 8.25l-3.5 3.5m0 0l-3.5-3.5m3.5 3.5V3.75M5.25 14.25v3A2.25 2.25 0 007.5 19.5h9a2.25 2.25 0 002.25-2.25v-3"
          />
        </svg>
        Get pricing
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-tp-hairline bg-tp-canvas p-1.5 shadow-elevation-3"
        >
          <div className="rounded-lg bg-tp-surface p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-tp-ink">Permanent link</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-tp-input-border bg-tp-input-bg p-1">
              <input
                aria-label="Permanent pricing link"
                readOnly
                value={permanentLink}
                onFocus={event => event.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-[10px] text-tp-steel outline-none"
              />
              <motion.button
                type="button"
                aria-label={copied ? 'Permanent link copied' : 'Copy permanent link'}
                onClick={copyPermanentLink}
                whileTap={{ scale: 0.86 }}
                animate={{ backgroundColor: copied ? '#16a34a' : undefined }}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md bg-tp-primary text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
              >
                <AnimatePresence mode="wait" initial={false}>
                  {copied ? (
                    <motion.svg
                      key="copied"
                      initial={{ scale: 0.45, opacity: 0, rotate: -12 }}
                      animate={{ scale: 1, opacity: 1, rotate: 0 }}
                      exit={{ scale: 0.45, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12.5l4.25 4.25L19 7"
                      />
                    </motion.svg>
                  ) : (
                    <motion.svg
                      key="copy"
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.7, opacity: 0 }}
                      transition={{ duration: 0.14 }}
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.6}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.25 8.25V6A2.25 2.25 0 0110.5 3.75h7.25A2.25 2.25 0 0120 6v7.25a2.25 2.25 0 01-2.25 2.25h-2.25M6 8.25h7.25A2.25 2.25 0 0115.5 10.5v7.25A2.25 2.25 0 0113.25 20H6a2.25 2.25 0 01-2.25-2.25V10.5A2.25 2.25 0 016 8.25z"
                      />
                    </motion.svg>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {copied ? 'Permanent link copied to clipboard' : ''}
            </span>
          </div>
          {yamlLink && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCopyYamlLink();
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left text-xs text-tp-ink hover:bg-tp-surface"
            >
              <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
                />
              </svg>
              <span>
                <span className="block font-medium">Copy YAML link</span>
                <span className="mt-0.5 block text-[11px] text-tp-steel">
                  Link to the selected version
                </span>
              </span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDownloadCurrent();
              setOpen(false);
            }}
            className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left text-xs text-tp-ink hover:bg-tp-surface"
          >
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-tp-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            <span>
              <span className="block font-medium">Download current version</span>
              <span className="mt-0.5 block text-[11px] text-tp-steel">
                Save the selected YAML file
              </span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={downloading}
            onClick={downloadAll}
            className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left text-xs text-tp-ink hover:bg-tp-surface disabled:cursor-wait disabled:opacity-60"
          >
            <HiOutlineFolderDownload color='#FA5210' size={16}/>
            <span>
              <span className="block font-medium">
                {downloading ? 'Preparing archive…' : 'Download all versions (.zip)'}
              </span>
              <span className="mt-0.5 block text-[11px] text-tp-steel">
                Bundle the versions you can access
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
