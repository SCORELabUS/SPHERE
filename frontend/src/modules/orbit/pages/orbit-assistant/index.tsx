import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MdAdd, MdDeleteOutline } from 'react-icons/md';
import customConfirm from '../../../core/utils/custom-confirm';
import { useOrbitChat } from '../../hooks/useOrbitChat';
import ConversationList from '../../components/conversation-list';
import OrbitAvatar from '../../components/orbit-avatar';
import OrbitThread from '../../components/orbit-thread';
import OrbitComposer, { type OrbitComposerHandle } from '../../components/orbit-composer';
import OrbitWelcome from '../../components/orbit-welcome';

export default function OrbitAssistantPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const conversationId = searchParams.get('c');
  const composerRef = useRef<OrbitComposerHandle>(null);

  const changeConversation = useCallback(
    (id: string | null) => setSearchParams(id ? { c: id } : {}, { replace: true }),
    [setSearchParams]
  );
  const chat = useOrbitChat({ conversationId, onConversationChange: changeConversation });

  const selectConversation = (id: string) => setSearchParams({ c: id });

  const confirmDelete = (conversation: { id: string; title: string }) => {
    customConfirm(`Delete "${conversation.title}"? A plan still waiting for confirmation in it will be cancelled.`, {
      danger: true,
      confirmLabel: 'Delete',
    })
      .then(() => chat.deleteConversation(conversation.id).catch(error => chat.reportError((error as Error).message)))
      .catch(() => undefined);
  };
  const currentConversation = chat.conversations.find(conversation => conversation.id === conversationId);
  const busy = chat.activity !== null || chat.running !== null;

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-7xl gap-4 px-4 py-4 md:px-6">
      {/* Conversations */}
      <aside className="hidden w-64 shrink-0 overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas md:block">
        <ConversationList
          conversations={chat.conversations}
          activeId={conversationId}
          answeringId={chat.answeringConversationId}
          onSelect={selectConversation}
          onNew={chat.startNew}
          onDelete={confirmDelete}
        />
      </aside>

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-1">
        <header className="flex items-center justify-between gap-3 border-b border-tp-hairline bg-tp-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <OrbitAvatar size="md" busy={busy} />
            <div className="min-w-0">
              <h1 className="font-display text-base font-normal text-tp-ink">ORBIT</h1>
              <p className="truncate text-[11px] text-tp-steel">
                {busy
                  ? chat.running
                    ? 'Applying a plan…'
                    : 'Working on it…'
                  : 'Your SPHERE assistant · proposes changes, you confirm them'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            {chat.conversations.length > 0 && (
              <select
                value={conversationId ?? ''}
                onChange={event => (event.target.value ? selectConversation(event.target.value) : chat.startNew())}
                className="max-w-[140px] cursor-pointer truncate rounded-lg border border-tp-hairline bg-tp-canvas px-2 py-1.5 text-[12px] text-tp-ink"
              >
                <option value="">New conversation</option>
                {chat.conversations.map(conversation => (
                  <option key={conversation.id} value={conversation.id}>
                    {conversation.title}
                  </option>
                ))}
              </select>
            )}
            {currentConversation && chat.answeringConversationId !== currentConversation.id && (
              <button
                type="button"
                onClick={() => confirmDelete(currentConversation)}
                aria-label="Delete this conversation"
                className="cursor-pointer rounded-lg border border-tp-hairline p-1.5 text-tp-slate transition-colors hover:bg-tp-hairline-soft hover:text-tp-severity-error"
              >
                <MdDeleteOutline size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={chat.startNew}
              aria-label="New conversation"
              className="cursor-pointer rounded-lg border border-tp-hairline p-1.5 text-tp-slate transition-colors hover:bg-tp-hairline-soft"
            >
              <MdAdd size={16} />
            </button>
          </div>
        </header>

        {chat.availability === 'unavailable' && (
          <div className="border-b border-tp-severity-warning-border bg-tp-severity-warning-bg px-4 py-2 text-[12px] text-tp-ink-tint">
            ORBIT is not available on this server right now. Ask an administrator to configure its OpenAI key.
          </div>
        )}

        <OrbitThread
          chat={chat}
          className="px-4 py-5"
          empty={
            <OrbitWelcome
              onPick={prompt => void chat.send(prompt)}
              onImport={() => composerRef.current?.pickFile()}
              disabled={chat.availability !== 'available'}
            />
          }
        />
        <OrbitComposer ref={composerRef} chat={chat} />
      </section>
    </div>
  );
}
