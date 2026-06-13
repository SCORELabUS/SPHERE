import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from '../../../../modules/harvey/types/types';
import type { SuggestedQuestion } from './index';
import HarveyChatMessage from './harvey-chat-message';
import HarveyChatInput from './harvey-chat-input';

interface Props {
  messages: ChatMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: (text: string) => void;
  onSuggestionClick: (question: string) => void;
  onClose: () => void;
  pricingName?: string;
  suggestedQuestions: SuggestedQuestion[];
}

const panelVariants = {
  hidden: {
    opacity: 0,
    y: 24,
    scale: 0.94,
    transformOrigin: 'bottom right',
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 340,
      damping: 28,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    y: 16,
    scale: 0.96,
    transition: { duration: 0.18, ease: 'easeIn' as const },
  },
};

export default function HarveyChatPanel({
  messages,
  inputValue,
  onInputChange,
  onSend,
  onSuggestionClick,
  onClose,
  pricingName,
  suggestedQuestions,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isWelcome = messages.length <= 1 && messages[0]?.role === 'assistant';

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  return (
    <motion.div
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed bottom-24 right-6 z-50 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-4"
      style={{ height: 'min(580px, calc(100vh - 140px))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-tp-hairline bg-tp-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-tp-cream text-xs font-bold text-tp-primary">
            H
          </div>
          <div>
            <h3 className="font-display text-sm font-normal text-tp-ink">H.A.R.V.E.Y.</h3>
            <p className="text-[11px] text-tp-steel">
              {pricingName ? `Ask about ${pricingName}` : 'Pricing assistant'}
            </p>
          </div>
        </div>
        <motion.button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-lg p-1.5 text-tp-steel transition-colors hover:bg-tp-hairline hover:text-tp-ink"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </motion.button>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{
          scrollBehavior: 'smooth',
          scrollbarWidth: 'thin',
          scrollbarColor: '#c7c7c7 transparent',
        }}
      >
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {messages.map((msg) => (
              <HarveyChatMessage key={msg.id} message={msg} />
            ))}
          </AnimatePresence>

          {/* Suggested questions — shown after welcome */}
          {isWelcome && suggestedQuestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.3 }}
              className="space-y-2 pt-1"
            >
              {suggestedQuestions.map((sq, i) => (
                <motion.button
                  key={sq.id}
                  type="button"
                  onClick={() => onSuggestionClick(sq.question)}
                  className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-tp-hairline bg-tp-surface px-3.5 py-2.5 text-left transition-all hover:border-tp-primary/30 hover:bg-tp-cream/40"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.08, duration: 0.25 }}
                  whileHover={{ x: 2 }}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-tp-cream text-[11px] text-tp-primary transition-colors group-hover:bg-tp-primary group-hover:text-tp-on-primary">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </span>
                  <span className="text-xs font-medium text-tp-slate transition-colors group-hover:text-tp-ink">
                    {sq.label}
                  </span>
                  <svg
                    className="ml-auto h-3.5 w-3.5 shrink-0 text-tp-muted opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-tp-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </motion.button>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Input */}
      <HarveyChatInput
        value={inputValue}
        onChange={onInputChange}
        onSend={onSend}
      />
    </motion.div>
  );
}
