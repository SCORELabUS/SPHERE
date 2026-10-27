import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
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
    delete process.env.ORBIT_OPENAI_BASE_URL;
    delete process.env.HTTP_PROXY;
    delete process.env.NO_PROXY;
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

  it('asks for whole answers when the provider refuses to stream, and stops trying to stream', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(400, {
          error: { message: 'Your organization must be verified to stream this model.', param: 'stream', code: 'unsupported_value' },
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'First' } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'Second' } }] }));
    const client = new OrbitLlmClient();
    const deltas: string[] = [];

    const first = await client.chatStream({ messages: [{ role: 'user', content: 'Hi' }] }, text => deltas.push(text));
    const second = await client.chatStream({ messages: [{ role: 'user', content: 'Again' }] }, text => deltas.push(text));

    expect(first.content).toBe('First');
    expect(second.content).toBe('Second');
    expect(deltas).toEqual(['First', 'Second']);
    const streamedFlags = fetchMock.mock.calls.map(call => JSON.parse(call[1].body).stream ?? false);
    expect(streamedFlags).toEqual([true, false, false]);
  });

  it('does not hide other errors behind the fallback', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { message: 'Invalid API key' } }));

    await expect(
      new OrbitLlmClient().chatStream({ messages: [{ role: 'user', content: 'Hi' }] }, () => undefined)
    ).rejects.toThrow('ORBIT UNAVAILABLE: The language model returned an error (Invalid API key)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('goes through the outbound proxy when one is set, and around it for hosts in no_proxy', async () => {
    // A stand-in for the proxy: it opens tunnels (CONNECT) to a local server
    // that answers for a host that does not exist, so only a request sent
    // through the proxy can succeed.
    const target = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Answered' } }] }));
    });
    const proxied: string[] = [];
    const proxyServer = http.createServer((req, res) => res.writeHead(405).end());
    proxyServer.on('connect', (req, clientSocket: net.Socket, head) => {
      proxied.push(String(req.url));
      const upstream = net.connect((target.address() as AddressInfo).port, '127.0.0.1', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(clientSocket).pipe(upstream);
      });
    });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    await new Promise<void>(resolve => proxyServer.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = proxyServer.address() as AddressInfo;
      process.env.ORBIT_OPENAI_BASE_URL = 'http://llm.invalid/v1';
      process.env.HTTP_PROXY = `http://127.0.0.1:${port}`;

      const response = await new OrbitLlmClient().chat({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(response.content).toBe('Answered');
      expect(proxied).toEqual(['llm.invalid:80']);
      expect(fetchMock).not.toHaveBeenCalled();

      // A host in no_proxy is reached directly, without a tunnel.
      process.env.NO_PROXY = '127.0.0.1';
      process.env.ORBIT_OPENAI_BASE_URL = `http://127.0.0.1:${(target.address() as AddressInfo).port}/v1`;
      expect((await new OrbitLlmClient().chat({ messages: [{ role: 'user', content: 'Hi' }] })).content).toBe('Answered');
      expect(proxied).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      for (const server of [proxyServer, target]) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }
  });
});
