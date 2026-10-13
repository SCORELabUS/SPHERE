import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrganization } from '../../organization/hooks/useOrganization';
import { useOrbitApi } from '../api/orbitApi';
import type {
  OrbitAttachmentInput,
  OrbitConversationSummary,
  OrbitMessage,
  OrbitPlan,
  OrbitProgressEvent,
} from '../types/orbit';

export type OrbitAvailability = 'idle' | 'loading' | 'available' | 'unavailable';

export interface OrbitActivityStep {
  label: string;
  startedAt: number;
  doneAt: number | null;
}

/** What ORBIT is doing for the message being answered right now. */
export interface OrbitActivity {
  startedAt: number;
  steps: OrbitActivityStep[];
  /** The answer as it is being written. */
  draft: string;
}

export interface OrbitPendingAttachment extends OrbitAttachmentInput {
  size: number;
}

interface Options {
  conversationId: string | null;
  onConversationChange: (conversationId: string | null) => void;
  /** Nothing is fetched until this turns true, so a closed widget costs nothing. */
  enabled?: boolean;
}

// Steps that say ORBIT is between two pieces of work rather than doing one.
const TRANSIENT_STEP = /^(Sending|Thinking it through|The AI provider is busy)/;

let localIdCounter = 0;
const localId = (prefix: string) => `${prefix}-${Date.now()}-${++localIdCounter}`;

/**
 * Everything a chat with ORBIT needs, shared by the full page and the floating
 * widget: the conversation, the plans in it, sending with live progress, and
 * confirming or cancelling plans.
 */
export function useOrbitChat({ conversationId, onConversationChange, enabled = true }: Options) {
  const api = useOrbitApi();
  // The app keeps the user's organizations in a shared context loaded at sign-in;
  // it has to be told when a plan changes them.
  const { refresh: refreshOrganizations } = useOrganization();

  const [availability, setAvailability] = useState<OrbitAvailability>('idle');
  const [conversations, setConversations] = useState<OrbitConversationSummary[]>([]);
  const [messages, setMessages] = useState<OrbitMessage[]>([]);
  const [plans, setPlans] = useState<Record<string, OrbitPlan>>({});
  const [activity, setActivity] = useState<OrbitActivity | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [running, setRunning] = useState<{ planId: string; index: number } | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [failedSend, setFailedSend] = useState<{ text: string; attachment: OrbitPendingAttachment | null } | null>(null);

  // A conversation started by the first message is already on screen; loading
  // it again would wipe the reply that is still on its way.
  const skipLoadRef = useRef<string | null>(null);
  const isSending = activity !== null;

  const refreshConversations = useCallback(() => {
    api.listConversations().then(setConversations).catch(() => undefined);
  }, [api]);

  useEffect(() => {
    if (!enabled || availability !== 'idle') return;
    setAvailability('loading');
    api
      .getStatus()
      .then(status => setAvailability(status.available ? 'available' : 'unavailable'))
      .catch(() => setAvailability('unavailable'));
    refreshConversations();
  }, [api, availability, enabled, refreshConversations]);

  useEffect(() => {
    if (!enabled) return;
    if (!conversationId) {
      setMessages([]);
      setPlans({});
      return;
    }
    if (skipLoadRef.current === conversationId) {
      skipLoadRef.current = null;
      return;
    }
    let cancelled = false;
    setIsLoadingConversation(true);
    api
      .getConversation(conversationId)
      .then(conversation => {
        if (cancelled) return;
        setMessages(conversation.messages);
        setPlans(Object.fromEntries(conversation.plans.map(plan => [plan.id, plan])));
      })
      .catch(() => {
        if (!cancelled) onConversationChange(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingConversation(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, enabled]);

  const appendLocalError = useCallback((text: string) => {
    setMessages(prev => [
      ...prev,
      {
        id: localId('error'),
        role: 'assistant',
        content: `Sorry, something went wrong: ${text}`,
        planId: null,
        attachment: null,
        createdAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const pushStep = useCallback((label: string) => {
    setActivity(prev => {
      if (!prev) return prev;
      const last = prev.steps[prev.steps.length - 1];
      if (last && last.label === label && last.doneAt === null) return prev;
      const now = Date.now();
      // Transitional steps ("Thinking it through", waiting on the provider) are
      // only worth showing while they last; the trail keeps the real work, once.
      const trail = prev.steps
        .filter(step => !(step.doneAt === null && TRANSIENT_STEP.test(step.label)))
        .map(step => (step.doneAt === null ? { ...step, doneAt: now } : step));
      const deduplicated = trail.filter(
        (step, index) => trail.findIndex(other => other.label === step.label) === index
      );
      return { ...prev, steps: [...deduplicated, { label, startedAt: now, doneAt: null }] };
    });
  }, []);

  const send = useCallback(
    async (text: string, attachment: OrbitPendingAttachment | null = null) => {
      const trimmed = text.trim();
      if ((!trimmed && !attachment) || isSending || availability !== 'available') return false;

      setFailedSend(null);
      const optimistic: OrbitMessage = {
        id: localId('pending'),
        role: 'user',
        content: trimmed || `I have attached "${attachment?.filename}".`,
        planId: null,
        attachment: attachment ? { id: 'pending', filename: attachment.filename, size: attachment.size } : null,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, optimistic]);
      // The first step shows at once, before any byte has left the browser.
      setActivity({
        startedAt: Date.now(),
        steps: [{ label: attachment ? 'Sending your file' : 'Sending', startedAt: Date.now(), doneAt: null }],
        draft: '',
      });

      try {
        let targetId = conversationId;
        if (!targetId) {
          const conversation = await api.createConversation();
          targetId = conversation.id;
          skipLoadRef.current = targetId;
          onConversationChange(targetId);
        }

        const result = await api.sendMessageStream(
          targetId,
          trimmed,
          attachment ? { filename: attachment.filename, content: attachment.content } : null,
          event => {
            if (event.type === 'accepted') {
              setMessages(prev => prev.map(message => (message.id === optimistic.id ? event.message : message)));
              setConversations(prev => {
                const others = prev.filter(conversation => conversation.id !== targetId);
                const now = new Date().toISOString();
                const existing = prev.find(conversation => conversation.id === targetId);
                return [{ id: targetId!, title: event.title, createdAt: existing?.createdAt ?? now, updatedAt: now }, ...others];
              });
            } else if (event.type === 'status') {
              pushStep(event.label);
            } else if (event.type === 'delta') {
              setActivity(prev => (prev ? { ...prev, draft: prev.draft + event.text } : prev));
            } else if (event.type === 'reset') {
              setActivity(prev => (prev ? { ...prev, draft: '' } : prev));
            }
          }
        );

        setMessages(prev => {
          const sentIds = new Set(result.messages.map(message => message.id));
          return [...prev.filter(message => message.id !== optimistic.id && !sentIds.has(message.id)), ...result.messages];
        });
        if (result.plan) {
          const newPlan = result.plan;
          setPlans(prev => {
            const next: Record<string, OrbitPlan> = {};
            for (const [id, plan] of Object.entries(prev)) {
              next[id] = plan.status === 'PENDING' ? { ...plan, status: 'SUPERSEDED' } : plan;
            }
            next[newPlan.id] = newPlan;
            return next;
          });
        }
        return true;
      } catch (error) {
        setFailedSend({ text: trimmed, attachment });
        appendLocalError((error as Error).message);
        return false;
      } finally {
        setActivity(null);
      }
    },
    [api, appendLocalError, availability, conversationId, isSending, onConversationChange, pushStep]
  );

  /** Sends the message that failed again, without the user retyping it. */
  const retry = useCallback(() => {
    if (!failedSend) return;
    const { text, attachment } = failedSend;
    // The failed attempt and its error are replaced by the new one.
    setMessages(prev => {
      const withoutError = prev[prev.length - 1]?.id.startsWith('error-') ? prev.slice(0, -1) : prev;
      const last = withoutError[withoutError.length - 1];
      return last?.role === 'user' && last.id.startsWith('pending-') ? withoutError.slice(0, -1) : withoutError;
    });
    void send(text, attachment);
  }, [failedSend, send]);

  const confirm = useCallback(
    async (planId: string) => {
      setBusyPlanId(planId);
      setRunning({ planId, index: 0 });
      setPlans(prev => ({ ...prev, [planId]: { ...prev[planId], status: 'EXECUTING' } }));

      const onEvent = (event: OrbitProgressEvent) => {
        if (event.type === 'step') {
          setPlans(prev => {
            const plan = prev[planId];
            if (!plan) return prev;
            const steps = plan.steps.map(step =>
              step.id === event.stepId ? { ...step, status: event.status, result: event.result, error: event.error } : step
            );
            return { ...prev, [planId]: { ...plan, steps } };
          });
          setRunning({ planId, index: event.index + 1 });
        } else if (event.type === 'done') {
          setPlans(prev => ({ ...prev, [planId]: event.plan }));
        }
      };

      try {
        const finished = await api.confirmPlan(planId, onEvent);
        setPlans(prev => ({ ...prev, [planId]: finished }));
      } catch (error) {
        appendLocalError((error as Error).message);
        api.getPlan(planId).then(plan => setPlans(prev => ({ ...prev, [planId]: plan }))).catch(() => undefined);
      } finally {
        setRunning(null);
        setBusyPlanId(null);
        // Even a failed run may have applied some steps.
        refreshOrganizations();
      }
    },
    [api, appendLocalError, refreshOrganizations]
  );

  const cancel = useCallback(
    async (planId: string) => {
      setBusyPlanId(planId);
      try {
        const plan = await api.cancelPlan(planId);
        setPlans(prev => ({ ...prev, [planId]: plan }));
      } catch (error) {
        appendLocalError((error as Error).message);
      } finally {
        setBusyPlanId(null);
      }
    },
    [api, appendLocalError]
  );

  const startNew = useCallback(() => {
    setFailedSend(null);
    onConversationChange(null);
  }, [onConversationChange]);

  return {
    availability,
    conversations,
    refreshConversations,
    messages,
    plans,
    activity,
    isSending,
    isLoadingConversation,
    running,
    busyPlanId,
    canRetry: failedSend !== null && !isSending,
    send,
    retry,
    confirm,
    cancel,
    startNew,
    reportError: appendLocalError,
  };
}

export type OrbitChat = ReturnType<typeof useOrbitChat>;
