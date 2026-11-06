import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MdClose } from 'react-icons/md';
import { HiOutlineChatBubbleLeftRight } from 'react-icons/hi2';
import {
  getAssistants,
  subscribeToAssistants,
  type AssistantEntry,
} from '../../utils/assistant-panels';

const spring = { type: 'spring', stiffness: 420, damping: 28 } as const;

/**
 * One bubble for every assistant on the page (HARVEY and ORBIT on a pricing,
 * for instance). Pressing it blurs the page and unfolds a bubble per assistant
 * to pick from; while one of their panels is open it closes that panel. With a
 * single assistant on the page it draws nothing and the assistant keeps its own
 * bubble (see `useAssistantLauncher`).
 */
export default function AssistantLauncher() {
  const assistants = useSyncExternalStore(subscribeToAssistants, getAssistants);
  const [expanded, setExpanded] = useState(false);
  const mainRef = useRef<HTMLButtonElement>(null);

  const grouped = assistants.length > 1;
  const openAssistant = assistants.find(assistant => assistant.isOpen);
  const pending = assistants.find(assistant => assistant.attention && !assistant.isOpen);
  const idle = !expanded && !openAssistant;

  useEffect(() => {
    if (!grouped || openAssistant) setExpanded(false);
  }, [grouped, openAssistant]);

  useEffect(() => {
    if (!expanded) return;
    getAssistants().forEach(assistant => assistant.prepare());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setExpanded(false);
      mainRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  if (!grouped) return null;

  const pick = (assistant: AssistantEntry) => {
    setExpanded(false);
    assistant.open();
  };

  const onMainClick = () => {
    if (openAssistant) openAssistant.close();
    else setExpanded(value => !value);
  };

  const mainLabel = openAssistant
    ? `Close ${openAssistant.name}`
    : expanded
      ? 'Close the assistant picker'
      : 'Choose an assistant';

  return (
    <>
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="assistant-launcher-backdrop"
            aria-hidden
            onClick={() => setExpanded(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[45] bg-tp-ink/10 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        <AnimatePresence>
          {expanded && (
            <motion.ul
              id="assistant-launcher-menu"
              role="menu"
              aria-label="Assistants"
              className="flex flex-col items-end gap-3"
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                visible: { transition: { staggerChildren: 0.06, staggerDirection: -1 } },
                hidden: { transition: { staggerChildren: 0.04 } },
              }}
            >
              {assistants.map(assistant => (
                <motion.li
                  key={assistant.id}
                  role="none"
                  variants={{
                    hidden: { opacity: 0, y: 24, scale: 0.5 },
                    visible: { opacity: 1, y: 0, scale: 1 },
                  }}
                  transition={spring}
                  style={{ transformOrigin: 'bottom right' }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => pick(assistant)}
                    onMouseEnter={assistant.prepare}
                    onFocus={assistant.prepare}
                    className="group flex cursor-pointer items-center gap-3 pr-1"
                  >
                    <span className="rounded-xl border border-tp-hairline bg-tp-canvas px-3 py-1.5 text-right shadow-elevation-2 transition-colors group-hover:border-tp-primary/40">
                      <span className="block text-[13px] font-medium text-tp-ink">{assistant.name}</span>
                      <span className="block text-[11px] text-tp-steel">{assistant.description}</span>
                    </span>
                    <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-tp-primary text-tp-on-primary shadow-elevation-3 transition-transform duration-150 group-hover:scale-[1.08] group-active:scale-95">
                      <assistant.Icon busy={assistant.busy} className="h-7 w-7" />
                      {assistant.attention && (
                        <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-tp-canvas bg-tp-severity-success" />
                      )}
                    </span>
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>

        <div className="relative">
          {idle && pending && (
            <button
              type="button"
              onClick={() => pick(pending)}
              className="absolute bottom-3 right-16 cursor-pointer whitespace-nowrap rounded-full border border-tp-hairline bg-tp-canvas px-3 py-1.5 text-[12px] font-medium text-tp-ink shadow-elevation-2 animate-slide-up hover:border-tp-primary/40"
            >
              {pending.attention}
            </button>
          )}
          {idle && <span className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full bg-tp-primary/20" />}
          <motion.button
            ref={mainRef}
            type="button"
            onClick={onMainClick}
            aria-label={mainLabel}
            title={mainLabel}
            aria-haspopup="menu"
            aria-expanded={expanded}
            aria-controls={expanded ? 'assistant-launcher-menu' : undefined}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            className="relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-tp-primary text-tp-on-primary shadow-elevation-3"
          >
            <AnimatePresence mode="wait" initial={false}>
              {idle ? (
                <motion.span
                  key="assistants"
                  initial={{ opacity: 0, rotate: 90, scale: 0.5 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: -90, scale: 0.5 }}
                  transition={{ duration: 0.18 }}
                >
                  <HiOutlineChatBubbleLeftRight size={26} />
                </motion.span>
              ) : (
                <motion.span
                  key="close"
                  initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
                  transition={{ duration: 0.18 }}
                >
                  <MdClose size={24} />
                </motion.span>
              )}
            </AnimatePresence>
            {idle && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-tp-cream text-[10px] font-bold text-tp-primary shadow-elevation-1">
                {assistants.length}
              </span>
            )}
            {idle && pending && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-tp-canvas bg-tp-severity-success" />
            )}
          </motion.button>
        </div>
      </div>
    </>
  );
}
