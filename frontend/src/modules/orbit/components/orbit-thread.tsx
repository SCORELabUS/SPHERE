import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { MdInsertDriveFile, MdRefresh } from 'react-icons/md';
import HarveyChatMessage from '../../core/components/harvey-chat/harvey-chat-message';
import type { ChatMessage } from '../../harvey/types/types';
import type { OrbitChat } from '../hooks/useOrbitChat';
import OrbitActivity from './orbit-activity';
import PlanCard from './plan-card';

interface Props {
  chat: OrbitChat;
  /** Shown when the conversation has no messages yet. */
  empty: ReactNode;
  className?: string;
}

// Within this distance of the bottom, new content keeps the view pinned to it.
const STICK_THRESHOLD_PX = 120;

/**
 * The scrolling list of a conversation: messages, the plan cards attached to
 * them, and ORBIT's live activity while it answers. It follows new content
 * only while the user is at the bottom, so reading back is never interrupted.
 */
export default function OrbitThread({ chat, empty, className = '' }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastCountRef = useRef(chat.messages.length);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  // A message the user just sent always brings the view down to it.
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (chat.messages.length > lastCountRef.current && last?.role === 'user') stickRef.current = true;
    lastCountRef.current = chat.messages.length;
  }, [chat.messages]);

  // Laid out before paint, so streamed text never flashes below the fold first.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.activity, chat.plans]);

  const lastMessage = chat.messages[chat.messages.length - 1];

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`flex-1 overflow-y-auto overscroll-contain ${className}`}
      style={{ scrollbarWidth: 'thin' }}
    >
      {chat.isLoadingConversation && chat.messages.length === 0 ? (
        <ThreadSkeleton />
      ) : chat.messages.length === 0 && !chat.activity ? (
        empty
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {chat.messages.map(message => (
            <HarveyChatMessage
              key={message.id}
              message={{ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt } as ChatMessage}
              assistantName="ORBIT"
              assistantInitial="O"
            >
              {message.attachment && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-lg border border-tp-hairline bg-tp-surface px-2 py-1 text-[11px] text-tp-slate">
                  <MdInsertDriveFile size={13} /> {message.attachment.filename}
                </span>
              )}
              {message.planId && chat.plans[message.planId] && (
                <PlanCard
                  plan={chat.plans[message.planId]}
                  runningIndex={chat.running?.planId === message.planId ? chat.running.index : null}
                  busy={chat.busyPlanId !== null || chat.running !== null}
                  onConfirm={chat.confirm}
                  onCancel={chat.cancel}
                />
              )}
              {chat.canRetry && message === lastMessage && message.id.startsWith('error-') && (
                <button
                  type="button"
                  onClick={chat.retry}
                  className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-tp-hairline bg-tp-canvas px-2.5 py-1 text-[12px] font-medium text-tp-slate transition-colors hover:border-tp-primary/40 hover:text-tp-ink"
                >
                  <MdRefresh size={14} /> Try again
                </button>
              )}
            </HarveyChatMessage>
          ))}
          {chat.activity && <OrbitActivity activity={chat.activity} />}
        </div>
      )}
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-label="Loading conversation">
      {[56, 72, 40].map((width, index) => (
        <div key={index} className={`flex ${index % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
          <div className={`flex gap-2.5 ${index % 2 === 0 ? 'flex-row-reverse' : ''}`} style={{ width: `${width}%` }}>
            <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-tp-hairline-soft" />
            <div className="flex-1 space-y-1.5">
              <span className="block h-3 w-16 animate-pulse rounded bg-tp-hairline-soft" />
              <span className="block h-10 animate-pulse rounded-2xl bg-tp-hairline-soft" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
