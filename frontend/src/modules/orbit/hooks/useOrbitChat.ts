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

/** `unavailable`: the server has no AI configured; `unreachable`: the server could not be reached, and is asked again. */
export type OrbitAvailability = 'idle' | 'loading' | 'available' | 'unavailable' | 'unreachable';

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
// How often a plan applied elsewhere (another tab, the widget) is checked on.
const RUNNING_PLAN_POLL_MS = 2500;
// The server's answer when a conversation has no room left for more messages.
export const CONVERSATION_FULL = /Start a new conversation to keep going/;
const STATUS_RETRY_BASE_MS = 3000;
const STATUS_RETRY_MAX_MS = 30000;

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
  const [failedSend, setFailedSend] = useState<{
    text: string;
    attachment: OrbitPendingAttachment | null;
    messageIds: string[];
  } | null>(null);

  // A conversation started by the first message is already on screen; loading
  // it again would wipe the reply that is still on its way.
  const skipLoadRef = useRef<string | null>(null);
  // The conversation on screen, read by a send that outlives a switch to another one.
  const currentIdRef = useRef(conversationId);
  currentIdRef.current = conversationId;
  // Bumped when a reply lands, so a load that started before it cannot overwrite it.
  const loadGenerationRef = useRef(0);
  const isSending = activity !== null;

  const refreshConversations = useCallback(() => {
    api.listConversations().then(setConversations).catch(() => undefined);
  }, [api]);

  // When the server cannot be reached (it may be restarting), it is asked again,
  // waiting a little longer each time.
  const statusRetryRef = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempts: 0,
    timer: null,
  });
  useEffect(() => () => clearTimeout(statusRetryRef.current.timer ?? undefined), []);

  useEffect(() => {
    if (!enabled || availability !== 'idle') return;
    setAvailability('loading');
    api
      .getStatus()
      .then(status => {
        statusRetryRef.current.attempts = 0;
        setAvailability(status.available ? 'available' : 'unavailable');
      })
      .catch(() => {
        setAvailability('unreachable');
        const retry = statusRetryRef.current;
        const delay = Math.min(STATUS_RETRY_MAX_MS, STATUS_RETRY_BASE_MS * 2 ** retry.attempts++);
        retry.timer = setTimeout(() => setAvailability('idle'), delay);
      });
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
    const generation = ++loadGenerationRef.current;
    // The previous conversation is cleared at once, so the skeleton shows
    // instead of its messages lingering under the newly selected one.
    setMessages([]);
    setPlans({});
    setIsLoadingConversation(true);
    api
      .getConversation(conversationId)
      .then(conversation => {
        if (cancelled || generation !== loadGenerationRef.current) return;
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
    const id = localId('error');
    setMessages(prev => [
      ...prev,
      {
        id,
        role: 'assistant',
        content: `Sorry, something went wrong: ${text}`,
        planId: null,
        attachment: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    return id;
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
        conversationId,
        startedAt: Date.now(),
        steps: [{ label: attachment ? 'Sending your file' : 'Sending', startedAt: Date.now(), doneAt: null }],
        draft: '',
      });

      // The user may open another conversation while this one is answered; the
      // reply is then only shown if they come back to it.
      let targetId = conversationId;
      const isOnScreen = () => currentIdRef.current === targetId;
      let sentMessageId = optimistic.id;

      try {
        if (!targetId) {
          const conversation = await api.createConversation();
          targetId = conversation.id;
          skipLoadRef.current = targetId;
          setActivity(prev => (prev ? { ...prev, conversationId: targetId } : prev));
          onConversationChange(targetId);
          currentIdRef.current = targetId;
        }

        const result = await api.sendMessageStream(
          targetId,
          trimmed,
          attachment ? { filename: attachment.filename, content: attachment.content } : null,
          event => {
            if (event.type === 'accepted') {
              sentMessageId = event.message.id;
              if (isOnScreen()) {
                setMessages(prev => prev.map(message => (message.id === optimistic.id ? event.message : message)));
              }
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

        if (!isOnScreen()) return true;
        loadGenerationRef.current++;
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
        // The server takes back a turn that failed, so the message is only on
        // screen; it stays there, with the error, until it is sent again.
        if (isOnScreen()) {
          const message = (error as Error).message;
          const errorId = appendLocalError(message);
          // A full conversation would refuse the retry too; the thread offers a new one instead.
          if (!CONVERSATION_FULL.test(message)) {
            setFailedSend({ text: trimmed, attachment, messageIds: [optimistic.id, sentMessageId, errorId] });
          }
        }
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
    const { text, attachment, messageIds } = failedSend;
    // The failed attempt and its error are replaced by the new one.
    setMessages(prev => prev.filter(message => !messageIds.includes(message.id)));
    void send(text, attachment);
  }, [failedSend, send]);

  const confirm = useCallback(
    async (planId: string, confirmation?: string) => {
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
        const finished = await api.confirmPlan(planId, onEvent, confirmation);
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

  // A plan applied from somewhere else (the widget, another tab), or cut off by
  // a restart of the server, is followed until it finishes.
  const watchedPlanIds = Object.values(plans)
    .filter(plan => plan.status === 'EXECUTING' && plan.id !== running?.planId)
    .map(plan => plan.id)
    .join(',');
  useEffect(() => {
    if (!enabled || !watchedPlanIds) return;
    const timer = setInterval(() => {
      for (const planId of watchedPlanIds.split(',')) {
        api
          .getPlan(planId)
          .then(plan => {
            setPlans(prev => (prev[planId] ? { ...prev, [planId]: plan } : prev));
            if (plan.status !== 'EXECUTING') refreshOrganizations();
          })
          .catch(() => undefined);
      }
    }, RUNNING_PLAN_POLL_MS);
    return () => clearInterval(timer);
  }, [api, enabled, refreshOrganizations, watchedPlanIds]);

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

  /** Deletes a conversation; leaving it first when it is the one on screen. */
  const deleteConversation = useCallback(
    async (id: string) => {
      await api.deleteConversation(id);
      setConversations(prev => prev.filter(conversation => conversation.id !== id));
      if (currentIdRef.current === id) {
        setFailedSend(null);
        onConversationChange(null);
      }
    },
    [api, onConversationChange]
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
    /** What ORBIT is doing, when the conversation it is answering is the one on screen. */
    activity: activity && activity.conversationId === conversationId ? activity : null,
    /** Whether ORBIT is answering, in this conversation or another one. */
    isSending,
    answeringConversationId: activity?.conversationId ?? null,
    isLoadingConversation,
    running,
    busyPlanId,
    canRetry: failedSend !== null && !isSending,
    send,
    retry,
    confirm,
    cancel,
    startNew,
    deleteConversation,
    reportError: appendLocalError,
  };
}

export type OrbitChat = ReturnType<typeof useOrbitChat>;
