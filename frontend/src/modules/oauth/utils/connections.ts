export type Assistant = 'claude' | 'openai';

/** A display grouping from the client's self-reported name, never an authorization decision. */
export function assistantOf(name: string): Assistant | null {
  if (/\bclaude\b/i.test(name)) return 'claude';
  if (/\b(chatgpt|codex|openai)\b/i.test(name)) return 'openai';
  return null;
}

export const assistantNames: Record<Assistant, string> = { claude: 'Claude', openai: 'ChatGPT & Codex' };

export function mcpServerUrl(api: string, origin: string): string {
  const base = new URL(api.replace(/\/$/, '') + '/', origin);
  return new URL('orbit/mcp', base).href;
}
