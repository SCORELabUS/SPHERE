import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PricingLinkModalProps {
  linkUrl: string;
  onClose: () => void;
}

export default function PricingLinkModal({ linkUrl, onClose }: PricingLinkModalProps) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-[90vw] max-w-150 rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-center text-xl font-bold text-tp-ink">Your link is ready!</h2>
        <p className="mt-2 text-center text-sm text-tp-steel">This link points directly to the YAML file of the selected pricing version. It can be used to integrate with some <a href="https://sphere-docs.vercel.app" target="_blank" rel="noopener noreferrer" className="cursor-pointer underline">Pricing Intelligence tools</a>.</p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-tp-hairline-strong bg-tp-surface p-2">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate text-xs text-tp-ink">{linkUrl}</p>
          </div>
          <motion.button
            type="button"
            onClick={() => { navigator.clipboard.writeText(linkUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            animate={{ backgroundColor: copied ? '#22c55e' : undefined }}
            transition={{ duration: 0.2 }}
            className="cursor-pointer shrink-0 rounded-md bg-tp-primary p-2 text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.svg key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }} className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></motion.svg>
              ) : (
                <motion.svg key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.15 }} className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></motion.svg>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
        <div className="mt-4 text-center"><button type="button" onClick={onClose} className="cursor-pointer text-xs text-tp-steel hover:text-tp-ink">Close</button></div>
      </div>
    </div>
  );
}
