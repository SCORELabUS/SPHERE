// HARVEY and ORBIT share the bottom-right corner: on a page with both, ORBIT's
// bubble sits above HARVEY's, and only one of their panels is open at a time.
const EVENT_NAME = 'sphere:assistant-panel-open';

export type AssistantPanel = 'harvey' | 'orbit';

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

// Which assistants are on the page right now, so each can make room for the other.
const present = new Map<AssistantPanel, number>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

/** Marks an assistant as shown on the page. Returns the function that removes it. */
export function registerAssistant(panel: AssistantPanel) {
  present.set(panel, (present.get(panel) ?? 0) + 1);
  notify();
  return () => {
    present.set(panel, Math.max(0, (present.get(panel) ?? 1) - 1));
    notify();
  };
}

export function subscribeToAssistants(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isAssistantPresent(panel: AssistantPanel): boolean {
  return (present.get(panel) ?? 0) > 0;
}
