import { forwardRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion } from 'framer-motion';
import type { ChatMessage } from '../../../../modules/harvey/types/types';

interface Props {
  message: ChatMessage;
  /** Name shown above the assistant's messages. ORBIT reuses this component. */
  assistantName?: string;
  /** What the assistant's avatar shows: a letter, or a small icon. */
  assistantInitial?: ReactNode;
  /** Rendered below the bubble, such as a plan card or an attached file. */
  children?: ReactNode;
  /** Extra classes for the rendered Markdown, such as how tables are laid out. */
  contentClassName?: string;
}

const bubbleVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 26 },
  },
};

// Takes a ref so AnimatePresence's popLayout mode can measure the message.
const HarveyChatMessage = forwardRef<HTMLDivElement, Props>(function HarveyChatMessage(
  { message, assistantName = 'H.A.R.V.E.Y.', assistantInitial = 'H', children, contentClassName = '' },
  ref
) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      ref={ref}
      variants={bubbleVariants}
      initial="hidden"
      animate="visible"
      layout
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex max-w-[85%] gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <motion.div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
            isUser
              ? 'bg-tp-primary text-tp-on-primary'
              : 'bg-tp-cream text-tp-primary'
          }`}
          whileHover={{ scale: 1.1 }}
        >
          {isUser ? 'U' : assistantInitial}
        </motion.div>

        {/* Bubble */}
        <div className={`flex min-w-0 flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <span className="mb-1 text-[11px] font-medium text-tp-steel">
            {isUser ? 'You' : assistantName}
          </span>
          {/* Wide content (tables, long ids) scrolls inside the bubble instead of overflowing the chat. */}
          <div
            className={`max-w-full rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere] [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:[overflow-wrap:normal] [&_th]:[overflow-wrap:normal] ${
              isUser
                ? 'rounded-tr-md bg-tp-primary text-tp-on-primary'
                : 'rounded-tl-md bg-tp-surface text-tp-ink'
            }`}
          >
            <div className={`prose prose-sm max-w-none prose-p:mb-1 prose-p:leading-relaxed prose-pre:rounded-lg prose-pre:bg-tp-surface-code prose-pre:text-tp-on-dark [&_p:last-child]:mb-0 ${contentClassName}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          </div>
          {children}
        </div>
      </div>
    </motion.div>
  );
});

export default HarveyChatMessage;
