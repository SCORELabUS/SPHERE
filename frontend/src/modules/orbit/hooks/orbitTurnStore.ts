import type { OrbitMessage, OrbitPlan } from '../types/orbit';
import type { OrbitPendingAttachment } from './useOrbitChat';

export interface OrbitActivityStep {
  label: string;
  startedAt: number;
  doneAt: number | null;
}

/** What ORBIT is doing for the message being answered right now. */
export interface OrbitActivity {
  /** The conversation being answered; null until a new one has been created. */
  conversationId: string | null;
  startedAt: number;
  steps: OrbitActivityStep[];
  /** The answer as it is being written. */
  draft: string;
}

/** How a turn ended, for whichever view shows its conversation at that moment. */
export type OrbitTurnOutcome =
  | {
      id: number;
      ok: true;
      conversationId: string;
      messages: OrbitMessage[];
      plan: OrbitPlan | null;
      /** Local copies the server's messages replace, such as the optimistic user message. */
      replaces: string[];
    }
  | {
      id: number;
      ok: false;
      conversationId: string | null;
      error: string;
      userMessage: OrbitMessage;
      retry: { text: string; attachment: OrbitPendingAttachment | null };
      replaces: string[];
    };

type OutcomeInput =
  | Omit<Extract<OrbitTurnOutcome, { ok: true }>, 'id'>
  | Omit<Extract<OrbitTurnOutcome, { ok: false }>, 'id'>;

let activity: OrbitActivity | null = null;
let outcome: OrbitTurnOutcome | null = null;
let outcomeCount = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/**
 * The message ORBIT is answering lives here rather than in a component, so it
 * outlives the view that sent it: leaving the ORBIT page for another one keeps
 * the progress on screen in the widget, and the reply reaches whichever view
 * shows the conversation when it lands. It lasts as long as the tab.
 */
export const orbitTurnStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getActivity: () => activity,
  getOutcome: () => outcome,
  setActivity(next: OrbitActivity | null | ((previous: OrbitActivity | null) => OrbitActivity | null)) {
    activity = typeof next === 'function' ? next(activity) : next;
    notify();
  },
  /** Ends the turn: the progress goes away and its outcome is announced. */
  finish(result: OutcomeInput) {
    outcome = { ...result, id: ++outcomeCount } as OrbitTurnOutcome;
    activity = null;
    notify();
  },
};

/** The thread once a finished turn is in it: the server's messages take the place of local copies. */
export function mergeTurn(messages: OrbitMessage[], result: Extract<OrbitTurnOutcome, { ok: true }>): OrbitMessage[] {
  const incoming = new Set(result.messages.map(message => message.id));
  return [
    ...messages.filter(message => !result.replaces.includes(message.id) && !incoming.has(message.id)),
    ...result.messages,
  ];
}

/** The plans once a finished turn is in: a new proposal replaces whatever was waiting. */
export function mergeTurnPlans(plans: Record<string, OrbitPlan>, plan: OrbitPlan | null): Record<string, OrbitPlan> {
  if (!plan) return plans;
  const next: Record<string, OrbitPlan> = {};
  for (const [id, existing] of Object.entries(plans)) {
    next[id] = existing.status === 'PENDING' && id !== plan.id ? { ...existing, status: 'SUPERSEDED' } : existing;
  }
  next[plan.id] = plan;
  return next;
}
