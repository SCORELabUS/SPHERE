import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  getAssistants,
  removeAssistant,
  setAssistant,
  subscribeToAssistants,
  type AssistantEntry,
} from '../utils/assistant-panels';

type Options = Omit<AssistantEntry, 'busy' | 'attention' | 'prepare'> & {
  busy?: boolean;
  attention?: string | null;
  prepare?: () => void;
};

/**
 * Shows an assistant on the page while `active`. Returns true when it shares the
 * page with another one: then `AssistantLauncher` draws a single bubble for all
 * of them and the assistant must hide its own.
 */
export function useAssistantLauncher(
  { id, name, description, Icon, isOpen, busy = false, attention = null, open, close, prepare }: Options,
  active = true
): boolean {
  // The latest callbacks, so the entry does not change every render.
  const actions = useRef({ open, close, prepare });
  actions.current = { open, close, prepare };

  useEffect(() => {
    if (!active) return;
    setAssistant({
      id,
      name,
      description,
      Icon,
      isOpen,
      busy,
      attention,
      open: () => actions.current.open(),
      close: () => actions.current.close(),
      prepare: () => actions.current.prepare?.(),
    });
  }, [active, id, name, description, Icon, isOpen, busy, attention]);

  useEffect(() => (active ? () => removeAssistant(id) : undefined), [active, id]);

  const assistants = useSyncExternalStore(subscribeToAssistants, getAssistants);
  return active && assistants.length > 1;
}
