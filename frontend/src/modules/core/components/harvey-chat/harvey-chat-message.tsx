import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion } from 'framer-motion';
import type { ChatMessage } from '../../../../modules/harvey/types/types';

interface Props {
  message: ChatMessage;
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

export default function HarveyChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <motion.div
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
          {isUser ? 'U' : 'H'}
        </motion.div>

        {/* Bubble */}
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <span className="mb-1 text-[11px] font-medium text-tp-steel">
            {isUser ? 'You' : 'H.A.R.V.E.Y.'}
          </span>
          <div
            className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
              isUser
                ? 'rounded-tr-md bg-tp-primary text-tp-on-primary'
                : 'rounded-tl-md bg-tp-surface text-tp-ink'
            }`}
          >
            <div className="prose prose-sm max-w-none prose-p:mb-1 prose-p:leading-relaxed prose-pre:rounded-lg prose-pre:bg-tp-surface-code prose-pre:text-tp-on-dark [&_p:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
