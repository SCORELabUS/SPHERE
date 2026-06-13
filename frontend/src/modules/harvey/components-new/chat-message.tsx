import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion } from 'framer-motion';
import type { ChatMessage } from '../types/types';
import { messageVariants, transitionDefault } from '../../core/utils/motion-variants';

interface Props {
  message: ChatMessage;
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      transition={transitionDefault}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex max-w-[80%] gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
            isUser
              ? 'bg-tp-primary text-tp-on-primary'
              : 'bg-tp-cream text-tp-primary'
          }`}
        >
          {isUser ? 'U' : 'H'}
        </div>

        {/* Content */}
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium text-tp-steel">
              {isUser ? 'You' : 'H.A.R.V.E.Y.'}
            </span>
            <span className="text-[11px] text-tp-muted">
              {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div
            className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
              isUser
                ? 'rounded-tr-sm bg-tp-cream text-tp-ink'
                : 'rounded-tl-sm bg-tp-surface text-tp-ink'
            }`}
          >
            <div className="prose prose-sm max-w-none prose-p:mb-1.5 prose-pre:rounded-lg prose-pre:bg-tp-surface-code prose-pre:text-tp-on-dark [&_table]:w-full [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          </div>

          {/* Metadata (plan/result) */}
          {(message.metadata?.plan || message.metadata?.result) && (
            <details className="mt-2 w-full">
              <summary className="cursor-pointer text-xs text-tp-steel hover:text-tp-ink">
                View reasoning context
              </summary>
              <div className="mt-2 space-y-2 rounded-lg border border-tp-hairline bg-tp-surface p-3">
                {message.metadata.plan && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-tp-slate">Plan</p>
                    <pre className="overflow-x-auto rounded-md bg-tp-surface-code p-2 text-xs text-tp-on-dark">
                      {JSON.stringify(message.metadata.plan, null, 2)}
                    </pre>
                  </div>
                )}
                {message.metadata.result && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-tp-slate">Result</p>
                    <pre className="overflow-x-auto rounded-md bg-tp-surface-code p-2 text-xs text-tp-on-dark">
                      {JSON.stringify(message.metadata.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    </motion.div>
  );
}
