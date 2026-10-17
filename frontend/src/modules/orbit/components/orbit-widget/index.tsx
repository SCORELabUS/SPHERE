import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MdAdd, MdClose, MdOpenInFull } from 'react-icons/md';
import { useAuth } from '../../../auth/hooks/useAuth';
import { announcePanelOpen, closeWhenOtherPanelOpens } from '../../../core/utils/assistant-panels';
import { useAssistantPresence } from '../../../core/hooks/useAssistantPresence';
import { useOrbitChat } from '../../hooks/useOrbitChat';
import OrbitAvatar from '../orbit-avatar';
import OrbitLogo from '../orbit-logo';
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
 * ORBIT on every signed-in page, as a bubble in the bottom-right corner (above
 * HARVEY's on the pages that have it). Nothing is fetched until the bubble is hovered
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
  const panelRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => closeWhenOtherPanelOpens('orbit', () => setOpen(false)), []);

  // The full page is ORBIT already, so the widget steps aside there.
  const onOrbitPage = location.pathname.startsWith('/orbit');

  // Leaving the ORBIT page while it answers hands the reply over to the widget,
  // which shows that conversation with its progress instead of losing it.
  const answeringId = chat.answeringConversationId;
  useEffect(() => {
    if (onOrbitPage || !answeringId || answeringId === conversationId) return;
    changeConversation(answeringId);
    setWarm(true);
    // Only when a reply starts or the page is left, not when the user picks another conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeringId, onOrbitPage]);
  // On a page with HARVEY, whose bubble keeps the corner, ORBIT's sits above it.
  const stacked = useAssistantPresence('orbit', 'harvey', !onOrbitPage);

  const openPanel = useCallback(() => {
    announcePanelOpen('orbit');
    setMounted(true);
    setOpen(true);
    setUnseenReply(false);
    // After the panel has started to appear, so the focus does not scroll the page.
    setTimeout(() => composerRef.current?.focus(), 60);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Only while ORBIT has the focus, so Escape still closes the page's own dialogs.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const focused = document.activeElement;
      if (panelRef.current?.contains(focused) || bubbleRef.current === focused) {
        setOpen(false);
        bubbleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (onOrbitPage) return null;

  const busy = chat.isSending || chat.running !== null;
  const title = chat.conversations.find(conversation => conversation.id === conversationId)?.title;

  return (
    <>
      {mounted && (
        <section
          ref={panelRef}
          aria-label="ORBIT assistant"
          aria-hidden={!open}
          className={`fixed left-2 right-2 z-30 flex flex-col overflow-hidden rounded-2xl border border-tp-hairline bg-tp-canvas shadow-elevation-4 transition-[opacity,transform,visibility] duration-200 ease-out sm:left-auto sm:right-6 sm:w-[410px] ${
            stacked ? 'bottom-[10.5rem]' : 'bottom-24'
          } ${open ? 'visible translate-y-0 scale-100 opacity-100' : 'pointer-events-none invisible translate-y-3 scale-[0.97] opacity-0'}`}
          style={{
            // Its top stays clear of the sticky header (3.5rem) with a small margin.
            height: stacked ? 'min(620px, calc(100dvh - 240px))' : 'min(620px, calc(100dvh - 168px))',
            transformOrigin: 'bottom right',
          }}
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

      <div className={`fixed right-6 z-30 transition-[bottom] duration-300 ease-out ${stacked ? 'bottom-24' : 'bottom-6'}`}>
        {!open && !mounted && (
          <span className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full bg-tp-primary/20" />
        )}
        <button
          ref={bubbleRef}
          type="button"
          onClick={() => (open ? setOpen(false) : openPanel())}
          onMouseEnter={() => setWarm(true)}
          onFocus={() => setWarm(true)}
          onTouchStart={() => setWarm(true)}
          aria-label={open ? 'Close ORBIT' : 'Open ORBIT, your SPHERE assistant'}
          aria-expanded={open}
          className="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-tp-primary text-tp-on-primary shadow-elevation-3 transition-transform duration-150 hover:scale-[1.06] active:scale-95"
        >
          {open ? <MdClose size={24} /> : <OrbitLogo busy={busy} className="h-8 w-8" />}
          {unseenReply && !open && (
            <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-tp-canvas bg-tp-severity-success" />
          )}
        </button>
        {unseenReply && !open && (
          <button
            type="button"
            onClick={openPanel}
            className="absolute bottom-3 right-16 cursor-pointer whitespace-nowrap rounded-full border border-tp-hairline bg-tp-canvas px-3 py-1.5 text-[12px] font-medium text-tp-ink shadow-elevation-2 animate-slide-up hover:border-tp-primary/40"
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
