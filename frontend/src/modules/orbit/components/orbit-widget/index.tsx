import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MdAdd, MdClose, MdOpenInFull } from 'react-icons/md';
import { useAuth } from '../../../auth/hooks/useAuth';
import { useOrbitChat } from '../../hooks/useOrbitChat';
import OrbitAvatar from '../orbit-avatar';
import OrbitThread from '../orbit-thread';
import OrbitComposer, { type OrbitComposerHandle } from '../orbit-composer';
import OrbitWelcome from '../orbit-welcome';

const storageKey = (userId: string) => `orbit.widget.conversation.${userId}`;

function readStoredConversation(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function storeConversation(userId: string | undefined, conversationId: string | null) {
  if (!userId) return;
  try {
    if (conversationId) localStorage.setItem(storageKey(userId), conversationId);
    else localStorage.removeItem(storageKey(userId));
  } catch {
    // Remembering the conversation is a convenience; without storage it starts fresh.
  }
}

/**
 * ORBIT on every signed-in page, as a bubble in the bottom-left corner (HARVEY
 * keeps the bottom-right one). Nothing is fetched until the bubble is hovered
 * or opened, and the panel stays mounted once opened, so closing and reopening
 * it is instant and keeps what was being typed.
 */
export default function OrbitWidget() {
  const location = useLocation();
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const userId = authUser.user?.id;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [warm, setWarm] = useState(false);
  const [unseenReply, setUnseenReply] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() => readStoredConversation(userId));
  const composerRef = useRef<OrbitComposerHandle>(null);

  useEffect(() => {
    setConversationId(readStoredConversation(userId));
  }, [userId]);

  const changeConversation = useCallback(
    (id: string | null) => {
      setConversationId(id);
      storeConversation(userId, id);
    },
    [userId]
  );

  const chat = useOrbitChat({ conversationId, onConversationChange: changeConversation, enabled: warm || open });

  // A reply that lands while the panel is closed is flagged on the bubble.
  const wasSendingRef = useRef(false);
  useEffect(() => {
    if (wasSendingRef.current && !chat.isSending && !open) setUnseenReply(true);
    wasSendingRef.current = chat.isSending;
  }, [chat.isSending, open]);

  const openPanel = useCallback(() => {
    setMounted(true);
    setOpen(true);
    setUnseenReply(false);
    // After the panel has started to appear, so the focus does not scroll the page.
    setTimeout(() => composerRef.current?.focus(), 60);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // The full page is ORBIT already.
  if (location.pathname.startsWith('/orbit')) return null;

  const busy = chat.isSending || chat.running !== null;
  const title = chat.conversations.find(conversation => conversation.id === conversationId)?.title;

  return (
    <>
      {mounted && (
        <section
          aria-label="ORBIT assistant"
          aria-hidden={!open}
          className={`fixed bottom-24 left-2 right-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-4 transition-[opacity,transform,visibility] duration-200 ease-out sm:left-6 sm:right-auto sm:w-[410px] ${
            open ? 'visible translate-y-0 scale-100 opacity-100' : 'pointer-events-none invisible translate-y-3 scale-[0.97] opacity-0'
          }`}
          style={{ height: 'min(620px, calc(100dvh - 140px))', transformOrigin: 'bottom left' }}
        >
          <header className="flex items-center justify-between gap-2 border-b border-tp-hairline bg-tp-surface px-3.5 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <OrbitAvatar size="md" busy={busy} />
              <div className="min-w-0">
                <h3 className="font-display text-sm font-normal text-tp-ink">ORBIT</h3>
                <p className="truncate text-[11px] text-tp-steel">
                  {busy ? (chat.running ? 'Applying a plan…' : 'Working on it…') : title ?? 'Your SPHERE assistant'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <HeaderButton label="New conversation" onClick={chat.startNew} disabled={chat.isSending}>
                <MdAdd size={17} />
              </HeaderButton>
              <HeaderButton
                label="Open in full page"
                onClick={() => {
                  setOpen(false);
                  navigate(conversationId ? `/orbit?c=${conversationId}` : '/orbit');
                }}
              >
                <MdOpenInFull size={15} />
              </HeaderButton>
              <HeaderButton label="Close" onClick={() => setOpen(false)}>
                <MdClose size={17} />
              </HeaderButton>
            </div>
          </header>

          {chat.availability === 'unavailable' && (
            <div className="border-b border-tp-severity-warning-border bg-tp-severity-warning-bg px-3.5 py-2 text-[12px] text-tp-ink-tint">
              ORBIT is not available on this server right now.
            </div>
          )}

          <OrbitThread
            chat={chat}
            className="px-3.5 py-4"
            empty={
              <OrbitWelcome
                compact
                onPick={prompt => void chat.send(prompt)}
                onImport={() => composerRef.current?.pickFile()}
                disabled={chat.availability !== 'available'}
              />
            }
          />
          <OrbitComposer ref={composerRef} chat={chat} placeholder="Ask ORBIT..." />
        </section>
      )}

      <div className="fixed bottom-6 left-6 z-50">
        {!open && !mounted && (
          <span className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full bg-tp-primary/20" />
        )}
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPanel())}
          onMouseEnter={() => setWarm(true)}
          onFocus={() => setWarm(true)}
          onTouchStart={() => setWarm(true)}
          aria-label={open ? 'Close ORBIT' : 'Open ORBIT, your SPHERE assistant'}
          aria-expanded={open}
          className="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-tp-primary text-tp-on-primary shadow-elevation-3 transition-transform duration-150 hover:scale-[1.06] active:scale-95"
        >
          {open ? <MdClose size={24} /> : <OrbitMark />}
          {busy && !open && (
            <span className="pointer-events-none absolute -inset-1.5 animate-orbit-spin" aria-hidden="true">
              <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-tp-canvas bg-tp-primary" />
            </span>
          )}
          {unseenReply && !open && (
            <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-tp-canvas bg-tp-severity-success" />
          )}
        </button>
        {unseenReply && !open && (
          <button
            type="button"
            onClick={openPanel}
            className="absolute bottom-3 left-16 cursor-pointer whitespace-nowrap rounded-full border border-tp-hairline bg-tp-canvas px-3 py-1.5 text-[12px] font-medium text-tp-ink shadow-elevation-2 animate-slide-up hover:border-tp-primary/40"
          >
            ORBIT replied
          </button>
        )}
      </div>
    </>
  );
}

function HeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-tp-steel transition-colors hover:bg-tp-hairline-soft hover:text-tp-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** A small planet with its ring, so the bubble does not read as a second HARVEY. */
function OrbitMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)" />
      <circle cx="20.2" cy="8.4" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
