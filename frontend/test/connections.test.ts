import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantOf, mcpServerUrl } from '../src/modules/oauth/utils/connections.ts';

test('groups recognized client names while retaining unknown applications', () => {
  for (const name of ['Claude', 'Claude Code', 'claude desktop']) assert.equal(assistantOf(name), 'claude');
  for (const name of ['Codex', 'Codex CLI', 'ChatGPT', 'OpenAI MCP']) assert.equal(assistantOf(name), 'openai');
  for (const name of ['MCP application', 'NotClaude', 'MyCodexProxy']) assert.equal(assistantOf(name), null);
});
test('the OAuth server URL follows the configured API origin and path', () => {
  assert.equal(mcpServerUrl('/api/v1', 'https://sphere.example'), 'https://sphere.example/api/v1/orbit/mcp');
  assert.equal(mcpServerUrl('/prefix/api/v1/', 'https://sphere.example'), 'https://sphere.example/prefix/api/v1/orbit/mcp');
  assert.equal(mcpServerUrl('https://api.example/api/v1', 'https://sphere.example'), 'https://api.example/api/v1/orbit/mcp');
});
