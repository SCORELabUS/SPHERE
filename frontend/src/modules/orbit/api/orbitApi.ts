import { useCallback } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import type {
  OrbitAttachmentInput,
  OrbitConversation,
  OrbitConversationSummary,
  OrbitMessage,
  OrbitPlan,
  OrbitProgressEvent,
  OrbitTurnEvent,
} from '../types/orbit';

const ORBIT_BASE_PATH = import.meta.env.VITE_API_URL + '/orbit';

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === 'string' && body.error ? body.error : fallback;
}

/** Splits a server-sent events stream into its events as they arrive. */
async function readEventStream<T>(response: Response, onEvent: (event: T) => void) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice(6))
        .join('\n');
      if (data) {
        try {
          onEvent(JSON.parse(data));
        } catch {
          // A malformed event is skipped; the final plan is fetched anyway.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export function useOrbitApi() {
  const { fetchWithInterceptor } = useAuth();

  const getStatus = useCallback(async (): Promise<{ available: boolean }> => {
    const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/status`);
    if (!response.ok) throw new Error(await readError(response, 'Could not reach ORBIT'));
    return response.json();
  }, [fetchWithInterceptor]);

  const listConversations = useCallback(async (): Promise<OrbitConversationSummary[]> => {
    const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/conversations`);
    if (!response.ok) throw new Error(await readError(response, 'Failed to load conversations'));
    return response.json();
  }, [fetchWithInterceptor]);

  const createConversation = useCallback(async (): Promise<OrbitConversation> => {
    const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/conversations`, { method: 'POST' });
    if (!response.ok) throw new Error(await readError(response, 'Failed to start a conversation'));
    return response.json();
  }, [fetchWithInterceptor]);

  const getConversation = useCallback(async (conversationId: string): Promise<OrbitConversation> => {
    const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/conversations/${conversationId}`);
    if (!response.ok) throw new Error(await readError(response, 'Conversation not found'));
    return response.json();
  }, [fetchWithInterceptor]);

  const sendMessage = useCallback(
    async (
      conversationId: string,
      content: string,
      attachment?: OrbitAttachmentInput | null
    ): Promise<{ messages: OrbitMessage[]; plan: OrbitPlan | null }> => {
      const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...(attachment ? { attachment } : {}) }),
      });
      if (!response.ok) throw new Error(await readError(response, 'ORBIT could not answer'));
      return response.json();
    },
    [fetchWithInterceptor]
  );

  /**
   * Sends a message and follows the turn as it happens: what ORBIT is doing and
   * its answer as it is written. Resolves with the finished turn.
   */
  const sendMessageStream = useCallback(
    async (
      conversationId: string,
      content: string,
      attachment: OrbitAttachmentInput | null,
      onEvent: (event: OrbitTurnEvent) => void
    ): Promise<{ messages: OrbitMessage[]; plan: OrbitPlan | null }> => {
      const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ content, ...(attachment ? { attachment } : {}) }),
      });
      if (!response.ok) throw new Error(await readError(response, 'ORBIT could not answer'));

      const outcome: { result: { messages: OrbitMessage[]; plan: OrbitPlan | null } | null; error: string | null } = {
        result: null,
        error: null,
      };
      await readEventStream<OrbitTurnEvent>(response, event => {
        if (event.type === 'done') outcome.result = { messages: event.messages, plan: event.plan };
        if (event.type === 'error') outcome.error = event.error;
        onEvent(event);
      });
      if (outcome.result) return outcome.result;
      throw new Error(outcome.error ?? 'The connection with ORBIT was cut before it answered');
    },
    [fetchWithInterceptor]
  );

  const getPlan = useCallback(async (planId: string): Promise<OrbitPlan> => {
    const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/plans/${planId}`);
    if (!response.ok) throw new Error(await readError(response, 'Plan not found'));
    return response.json();
  }, [fetchWithInterceptor]);

  /** Confirms a plan and reports each step as the server applies it. */
  const confirmPlan = useCallback(
    async (planId: string, onEvent: (event: OrbitProgressEvent) => void): Promise<OrbitPlan> => {
      const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/plans/${planId}/confirm`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
      });
      if (!response.ok) throw new Error(await readError(response, 'The plan could not be applied'));

      const outcome: { plan: OrbitPlan | null; error: string | null } = { plan: null, error: null };
      await readEventStream<OrbitProgressEvent>(response, event => {
        if (event.type === 'done') outcome.plan = event.plan;
        if (event.type === 'error') outcome.error = event.error;
        onEvent(event);
      });

      // If the stream was cut short the plan still holds the outcome.
      if (outcome.plan) return outcome.plan;
      if (outcome.error) throw new Error(outcome.error);
      return getPlan(planId);
    },
    [fetchWithInterceptor, getPlan]
  );

  const cancelPlan = useCallback(async (planId: string): Promise<OrbitPlan> => {
    const response = await fetchWithInterceptor(`${ORBIT_BASE_PATH}/plans/${planId}/cancel`, { method: 'POST' });
    if (!response.ok) throw new Error(await readError(response, 'The plan could not be cancelled'));
    return response.json();
  }, [fetchWithInterceptor]);

  return {
    getStatus,
    listConversations,
    createConversation,
    getConversation,
    sendMessage,
    sendMessageStream,
    getPlan,
    confirmPlan,
    cancelPlan,
  };
}
