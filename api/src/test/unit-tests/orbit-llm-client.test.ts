import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrbitLlmClient from '../../main/services/orbit/OrbitLlmClient';

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const streamResponse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );

describe('OrbitLlmClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.ORBIT_OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env.ORBIT_OPENAI_API_KEY;
  });

  it('waits as long as the provider asks and tries again when it is rate limited', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'Rate limit reached. Please try again in 0.05s.' } }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'Hello' } }] }));
    const onRateLimit = vi.fn();

    const response = await new OrbitLlmClient().chat({ messages: [{ role: 'user', content: 'Hi' }], onRateLimit });

    expect(response.content).toBe('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRateLimit).toHaveBeenCalledWith(1);
    // The callback is ORBIT's own and never goes to the provider.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('onRateLimit');
  });

  it('gives up with a readable message when the wait is too long', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: { message: 'Please try again in 2m10s.' } }));

    await expect(new OrbitLlmClient().chat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      'ORBIT UNAVAILABLE: The AI provider is receiving too many requests right now. Try again in about 130 seconds.'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('puts streamed text and tool-call fragments back together', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Let me "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"check."}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_members","arguments":"{\\"organ"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"izationId\\":\\"x\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const deltas: string[] = [];

    const response = await new OrbitLlmClient().chatStream({ messages: [{ role: 'user', content: 'Hi' }] }, text => deltas.push(text));

    expect(deltas).toEqual(['Let me ', 'check.']);
    expect(response.content).toBe('Let me check.');
    expect(response.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'list_members', arguments: '{"organizationId":"x"}' } },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });
});
