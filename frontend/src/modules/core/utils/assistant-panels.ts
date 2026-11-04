import type { ComponentType } from 'react';

// HARVEY and ORBIT share the bottom-right corner: on a page with more than one
// assistant their bubbles fold into a single launcher (`AssistantLauncher`), and
// only one of their panels is open at a time.
const EVENT_NAME = 'sphere:assistant-panel-open';

export type AssistantPanel = 'harvey' | 'orbit';

// Order of the bubbles in the launcher, from the top.
const ORDER: AssistantPanel[] = ['orbit', 'harvey'];

export interface AssistantEntry {
  id: AssistantPanel;
  name: string;
  description: string;
  /** A component rather than an element, so the entry stays stable between renders. */
  Icon: ComponentType<{ busy?: boolean; className?: string }>;
  isOpen: boolean;
  busy: boolean;
  /** Short note shown next to the launcher, e.g. "ORBIT replied". */
  attention: string | null;
  open: () => void;
  close: () => void;
  /** Lets the assistant load what it needs when it is about to be picked. */
  prepare: () => void;
}

/** Tells the other assistant that this one has just opened its panel. */
export function announcePanelOpen(panel: AssistantPanel) {
  window.dispatchEvent(new CustomEvent<AssistantPanel>(EVENT_NAME, { detail: panel }));
}

/** Calls `close` when the other assistant opens its panel. Returns the function that stops listening. */
export function closeWhenOtherPanelOpens(panel: AssistantPanel, close: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<AssistantPanel>).detail !== panel) close();
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

// The assistants shown on the page right now.
const entries = new Map<AssistantPanel, AssistantEntry>();
let snapshot: AssistantEntry[] = [];
const listeners = new Set<() => void>();

function publish() {
  snapshot = ORDER.flatMap(id => entries.get(id) ?? []);
  listeners.forEach(listener => listener());
}

/** Adds or refreshes an assistant on the page. */
export function setAssistant(entry: AssistantEntry) {
  entries.set(entry.id, entry);
  publish();
}

export function removeAssistant(id: AssistantPanel) {
  if (entries.delete(id)) publish();
}

export function subscribeToAssistants(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAssistants(): AssistantEntry[] {
  return snapshot;
}
