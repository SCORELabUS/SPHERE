import { MdAdd, MdChatBubbleOutline } from 'react-icons/md';
import type { OrbitConversationSummary } from '../types/orbit';

interface Props {
  conversations: OrbitConversationSummary[];
  activeId: string | null;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
}

export default function ConversationList({ conversations, activeId, onSelect, onNew }: Props) {
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
            {conversations.map(conversation => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    conversation.id === activeId ? 'bg-tp-cream text-tp-ink' : 'text-tp-slate hover:bg-tp-surface'
                  }`}
                >
                  <MdChatBubbleOutline size={14} className="mt-[3px] shrink-0 text-tp-stone" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{conversation.title}</span>
                    <span className="block text-[11px] text-tp-stone">
                      {new Date(conversation.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
