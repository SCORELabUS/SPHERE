import { MdAdd, MdChatBubbleOutline, MdDeleteOutline } from 'react-icons/md';
import type { OrbitConversationSummary } from '../types/orbit';

interface Props {
  conversations: OrbitConversationSummary[];
  activeId: string | null;
  /** The conversation ORBIT is answering right now, if any. */
  answeringId?: string | null;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onDelete?: (conversation: OrbitConversationSummary) => void;
}

export default function ConversationList({
  conversations,
  activeId,
  answeringId = null,
  onSelect,
  onNew,
  onDelete,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-tp-hairline-soft p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-tp-primary px-3 py-2 text-[13px] font-semibold text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
        >
          <MdAdd size={16} /> New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2" style={{ scrollbarWidth: 'thin' }}>
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-[12px] text-tp-stone">Your conversations with ORBIT will appear here.</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map(conversation => {
              const answering = conversation.id === answeringId;
              return (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    className={`flex w-full cursor-pointer items-start gap-2 rounded-lg py-2 pl-2.5 pr-8 text-left transition-colors ${
                      conversation.id === activeId ? 'bg-tp-cream text-tp-ink' : 'text-tp-slate hover:bg-tp-surface'
                    }`}
                  >
                    <MdChatBubbleOutline size={14} className="mt-[3px] shrink-0 text-tp-stone" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{conversation.title}</span>
                      <span className="block text-[11px] text-tp-stone">
                        {new Date(conversation.updatedAt).toLocaleDateString()}
                      </span>
                    </span>
                  </button>
                  {answering ? (
                    <span
                      className="pointer-events-none absolute right-3 top-[15px] h-2 w-2 animate-pulse rounded-full bg-tp-primary"
                      title="ORBIT is answering"
                      aria-label="ORBIT is answering"
                    />
                  ) : (
                    onDelete && (
                      // Shown on hover or focus; always reachable with the keyboard.
                      <button
                        type="button"
                        onClick={() => onDelete(conversation)}
                        aria-label={`Delete "${conversation.title}"`}
                        title="Delete conversation"
                        className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-tp-stone opacity-0 transition-opacity hover:bg-tp-hairline-soft hover:text-tp-severity-error focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                      >
                        <MdDeleteOutline size={15} />
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
