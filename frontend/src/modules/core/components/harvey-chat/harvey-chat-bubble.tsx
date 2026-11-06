import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { HARVEY_ICON_BUBBLE, HARVEY_ICON_DOTS } from './harvey-icon';

interface Props {
  isOpen: boolean;
  onClick: () => void;
}

export default function HarveyChatBubble({ isOpen, onClick }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Pulse ring — only when closed */}
      {!isOpen && (
        <div className="absolute inset-0 animate-pulse-ring rounded-full bg-tp-primary/20" />
      )}

      {/* Main button */}
      <motion.button
        type="button"
        onClick={onClick}
        className={`relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-tp-primary text-tp-on-primary shadow-elevation-3 ${
          mounted && !isOpen ? 'animate-wiggle-bubble' : ''
        }`}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        animate={isOpen ? { rotate: 0 } : undefined}
        transition={{ duration: 0.2 }}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.svg
              key="close"
              initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
              transition={{ duration: 0.2 }}
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </motion.svg>
          ) : (
            <motion.svg
              key="chat"
              initial={{ opacity: 0, rotate: 90, scale: 0.5 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: -90, scale: 0.5 }}
              transition={{ duration: 0.2 }}
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={HARVEY_ICON_DOTS} />
              <path strokeLinecap="round" strokeLinejoin="round" d={HARVEY_ICON_BUBBLE} />
            </motion.svg>
          )}
        </AnimatePresence>

        {/* Label badge */}
        {!isOpen && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-tp-cream text-[10px] font-bold text-tp-primary shadow-elevation-1 animate-fade-in">
            H
          </span>
        )}
      </motion.button>
    </div>
  );
}
