import { EnvHttpProxyAgent, fetch as fetchThroughProxy } from 'undici';
import { OrbitToolCall } from '../../types/models/Orbit';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OrbitToolCall[];
  tool_call_id?: string;
}

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface LlmChatRequest {
  messages: LlmMessage[];
  tools?: LlmTool[];
  /** Ask for a single JSON object back instead of free text. */
  json?: boolean;
  /** Told how long the client waits when the provider asks it to slow down. */
  onRateLimit?: (waitSeconds: number) => void;
}

export interface LlmChatResponse {
  content: string | null;
  toolCalls: OrbitToolCall[];
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
// ORBIT shares HARVEY's model and key unless told otherwise.
const DEFAULT_MODEL = 'gpt-5-nano';
const REQUEST_TIMEOUT_MS = 90_000;
// Free tiers answer 429 with a short wait; waiting that long beats failing the turn.
const MAX_RATE_LIMIT_WAIT_SECONDS = 30;
const MAX_RATE_LIMIT_RETRIES = 2;

/** How long the provider asked to wait, from its header or from the error text. */
function retryAfterSeconds(response: Response, detail: string): number | null {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header;
  const match = detail.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*s/i);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2]);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const PROXY_VARIABLES = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'];
const NO_PROXY_VARIABLES = ['no_proxy', 'NO_PROXY'];
let proxy: { settings: string; agent: EnvHttpProxyAgent } | null = null;

/**
 * The agent that sends requests through the outbound proxy, when one is set.
 * Production servers only reach the internet through it, and Node's built-in
 * fetch ignores the http(s)_proxy variables, so they are honoured here,
 * no_proxy included. Rebuilt only when those variables change.
 */
function proxyAgent(): EnvHttpProxyAgent | null {
  if (!PROXY_VARIABLES.some(name => process.env[name])) return null;
  const settings = [...PROXY_VARIABLES, ...NO_PROXY_VARIABLES].map(name => process.env[name] ?? '').join('|');
  if (proxy?.settings !== settings) {
    void proxy?.agent.close();
    proxy = { settings, agent: new EnvHttpProxyAgent() };
  }
  return proxy.agent;
}

/**
 * Whether the provider turned the request down because it was streamed: OpenAI,
 * for one, only streams some models to verified organizations.
 */
function isStreamingRefusal(err: any): boolean {
  if (err?.providerStatus !== 400 && err?.providerStatus !== 403) return false;
  return err.providerParam === 'stream' || /\bstream/i.test(String(err.providerDetail ?? ''));
}

/**
 * The only piece of ORBIT that talks to the language model, through OpenAI's
 * chat completions API. Kept behind this class so tests can swap it out.
 */
class OrbitLlmClient {
  private streamingRefused = false;

  private get apiKey(): string {
    return (
      process.env.ORBIT_OPENAI_API_KEY ||
      process.env.HARVEY_API_KEY ||
      process.env.OPENAI_API_KEY ||
      ''
    );
  }

  private get model(): string {
    return process.env.ORBIT_OPENAI_MODEL || DEFAULT_MODEL;
  }

  private get baseUrl(): string {
    return (process.env.ORBIT_OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const { response, done } = await this.send(request, false);
    try {
      const payload: any = await response.json().catch(() => ({}));
      const message = payload?.choices?.[0]?.message ?? {};
      return {
        content: typeof message.content === 'string' ? message.content : null,
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      };
    } finally {
      done();
    }
  }

  /**
   * Same as chat, but hands over the answer's text as it is generated, so the
   * user sees ORBIT writing instead of waiting for the whole reply. Tool calls
   * arrive in fragments too and are put back together here.
   */
  async chatStream(request: LlmChatRequest, onDelta: (text: string) => void): Promise<LlmChatResponse> {
    if (!this.streamingRefused) {
      try {
        return await this.readStream(await this.send(request, true), onDelta);
      } catch (err) {
        if (!isStreamingRefusal(err)) throw err;
        // Asked once; from then on every answer is requested whole.
        this.streamingRefused = true;
      }
    }
    const response = await this.chat(request);
    if (response.content) onDelta(response.content);
    return response;
  }

  private async readStream(
    { response, done }: { response: Response; done: () => void },
    onDelta: (text: string) => void
  ): Promise<LlmChatResponse> {
    let content = '';
    const toolCalls: OrbitToolCall[] = [];

    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('ORBIT UNAVAILABLE: The language model sent an empty stream');
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          let chunk: any;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          if (chunk?.error) {
            throw new Error(`ORBIT UNAVAILABLE: The language model returned an error (${chunk.error.message ?? 'stream error'})`);
          }
          const delta = chunk?.choices?.[0]?.delta ?? {};
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            onDelta(delta.content);
          }
          for (const fragment of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
            const index = Number.isInteger(fragment.index) ? fragment.index : toolCalls.length;
            const call = (toolCalls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
            if (fragment.id) call.id = fragment.id;
            if (fragment.function?.name) call.function.name += fragment.function.name;
            if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
          }
        }
      }
    } catch (err: any) {
      const message = String(err?.message ?? err);
      if (message.startsWith('ORBIT UNAVAILABLE')) throw err;
      const reason = err?.name === 'AbortError' ? 'the request timed out' : message;
      throw new Error(`ORBIT UNAVAILABLE: The answer of the language model was cut off (${reason})`);
    } finally {
      done();
    }

    return { content: content || null, toolCalls: toolCalls.filter(call => call && call.function.name) };
  }

  private async send(request: LlmChatRequest, stream: boolean, attempt = 0): Promise<{ response: Response; done: () => void }> {
    if (!this.isConfigured()) {
      throw new Error('ORBIT UNAVAILABLE: No OpenAI API key is configured for ORBIT');
    }

    const body: Record<string, any> = {
      model: this.model,
      messages: request.messages,
    };
    if (stream) body.stream = true;
    if (request.tools?.length) {
      body.tools = request.tools;
      body.tool_choice = 'auto';
    }
    if (request.json) {
      body.response_format = { type: 'json_object' };
    }

    // The timeout covers the whole exchange, streamed body included.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const done = () => clearTimeout(timeout);

    let response: Response;
    try {
      const url = `${this.baseUrl}/chat/completions`;
      const init = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      };
      const agent = proxyAgent();
      response = agent
        ? ((await fetchThroughProxy(url, { ...init, dispatcher: agent })) as unknown as Response)
        : await fetch(url, init);
    } catch (err: any) {
      done();
      const reason = err?.name === 'AbortError' ? 'the request timed out' : String(err?.message ?? err);
      throw new Error(`ORBIT UNAVAILABLE: Could not reach the language model (${reason})`);
    }

    if (!response.ok) {
      const payload: any = await response.json().catch(() => ({}));
      done();
      const detail = String(payload?.error?.message ?? `HTTP ${response.status}`);

      if (response.status === 429) {
        const wait = retryAfterSeconds(response, detail);
        if (wait !== null && wait <= MAX_RATE_LIMIT_WAIT_SECONDS && attempt < MAX_RATE_LIMIT_RETRIES) {
          request.onRateLimit?.(Math.ceil(wait));
          await sleep(Math.ceil(wait * 1000) + 250);
          return this.send(request, stream, attempt + 1);
        }
        const when = wait !== null ? ` Try again in about ${Math.ceil(wait)} seconds.` : ' Try again in a moment.';
        throw new Error(`ORBIT UNAVAILABLE: The AI provider is receiving too many requests right now.${when}`);
      }
      throw Object.assign(new Error(`ORBIT UNAVAILABLE: The language model returned an error (${detail})`), {
        providerStatus: response.status,
        providerDetail: detail,
        providerParam: payload?.error?.param ?? null,
      });
    }
    return { response, done };
  }
}

export default OrbitLlmClient;
