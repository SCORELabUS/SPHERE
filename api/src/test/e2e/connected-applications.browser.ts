import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// The shared test harness drops its database. Fail before importing it if misconfigured.
if (process.env.DATABASE_NAME !== 'sphere_scratch' || process.env.MONGO_PORT !== '27018' ||
    process.env.REDIS_URL !== 'redis://127.0.0.1:6378') throw new Error('Browser E2E requires sphere_scratch, Mongo 27018 and Redis 6378');
const origin = 'http://127.0.0.1:5175';
process.env.FRONTEND_URL = origin;
process.env.OAUTH_ISSUER_URL = origin;
process.env.SERVER_PORT = '0';
const { default: testContainer } = await import('../utils/config/testContainer');
const { createAndLoginUser } = await import('../utils/users/userTestUtils');
const { createTestOrganization } = await import('../utils/organizations');
const { shutdownApp } = await import('../utils/testApp');
const { TEST_PASSWORD } = await import('../utils/config/variables');
const { OAuthGrant } = await import('../../main/repositories/mongoose/models/OAuthMongoose');
const app = testContainer.resolve('app');
const apiOrigin = `http://127.0.0.1:${(app as Server).address() && ((app as Server).address() as AddressInfo).port}`;
const resource = origin + '/api/v1/orbit/mcp';
let vite: ChildProcess;
let browser: Browser;
let page: Page;
let user: Awaited<ReturnType<typeof createAndLoginUser>>['user'];
let firstOrg: { id: string; displayName: string };
let secondOrg: { id: string; displayName: string };
const screenshotDir = process.env.SPHERE_E2E_ARTIFACTS || 'test-results/connected-applications';

beforeAll(async () => {
  ({ user } = await createAndLoginUser('USER', 'apps_e2e_' + Date.now()));
  firstOrg = await createTestOrganization(user.token, { displayName: 'E2E Product Studio' });
  secondOrg = await createTestOrganization(user.token, { displayName: 'E2E Research Lab' });
  vite = spawn(process.execPath, ['../frontend/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], {
    cwd: '../frontend', env: { ...process.env, VITE_API_URL: '/api/v1', VITE_API_PROXY_TARGET: apiOrigin, VITE_SECRET_KEY: 'sphere-e2e-browser-only' }, stdio: 'pipe',
  });
  let output = '';
  vite.stdout?.on('data', data => { output += String(data); });
  vite.stderr?.on('data', data => { output += String(data); });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (vite.exitCode !== null) throw new Error('Vite exited: ' + output);
    try { if ((await fetch(origin)).ok) break; } catch { /* Wait for Vite to listen. */ }
    if (attempt === 149) throw new Error('Vite did not start: ' + output);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.SPHERE_E2E_BROWSER_CHANNEL ? { channel: process.env.SPHERE_E2E_BROWSER_CHANNEL } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await mkdir(screenshotDir, { recursive: true });
  await page.goto(origin + '/authentication');
  await page.getByLabel('Username or Email', { exact: true }).fill(user.username);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(origin + '/');
});

afterAll(async () => {
  await browser?.close();
  if (vite && vite.exitCode === null) { const stopped = once(vite, 'exit'); vite.kill('SIGTERM'); await stopped; }
  await shutdownApp();
});

async function settle() {
  await page.waitForFunction(`Array.from(document.querySelectorAll('[style*="opacity"]')).every(element => getComputedStyle(element).opacity === '1')`);
}

async function settings() {
  await page.goto(origin + '/me/settings?section=applications');
  await page.getByRole('heading', { name: 'Your assistants. Your access.' }).waitFor();
  await page.getByRole('button', { name: 'Refresh connections' }).waitFor();
  await expect.poll(() => page.getByRole('button', { name: 'Refresh connections' }).isDisabled()).toBe(false);
}

async function connect(clientName: string) {
  const redirectUri = apiOrigin + '/oauth-client/callback';
  const registered = await request(app).post('/api/v1/oauth/register').send({ client_name: clientName, redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }).expect(201);
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: registered.body.client_id, redirect_uri: redirectUri, response_type: 'code',
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource });
  await page.goto(origin + '/api/v1/oauth/authorize?' + params);
  await page.getByRole('heading', { name: 'Connect your assistant' }).waitFor();
  await page.getByRole('textbox', { name: 'Search organizations' }).fill(firstOrg.displayName);
  await page.getByRole('button', { name: new RegExp(firstOrg.displayName) }).click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Allow access' }).click();
  await page.waitForURL(url => url.pathname === '/oauth-client/callback' && url.searchParams.has('code'));
  const code = new URL(page.url()).searchParams.get('code');
  const exchanged = await request(app).post('/api/v1/oauth/token').type('form').send({ client_id: registered.body.client_id,
    redirect_uri: redirectUri, grant_type: 'authorization_code', code, code_verifier: verifier, resource }).expect(200);
  return { clientId: registered.body.client_id, access: exchanged.body.access_token };
}

it('connects via real OAuth consent, edits organizations and scopes, enforces them in MCP, and disconnects', async () => {
  await settings();
  const claudeCard = page.getByRole('article', { name: 'Claude', exact: true });
  const openaiCard = page.getByRole('article', { name: 'ChatGPT & Codex', exact: true });
  await claudeCard.getByRole('button', { name: 'Connect Claude', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect Claude to SPHERE' }).waitFor();
  expect(await page.locator('#assistant-connection-guide code').textContent()).toBe(resource);
  expect(await claudeCard.locator('button', { hasText: 'Connect' }).getAttribute('class')).toContain('border-dashed');
  await settle();
  await page.screenshot({ path: screenshotDir + '/01-connect.png', fullPage: true });
  const claude = await connect('Claude');
  await settings();
  await claudeCard.getByRole('button', { name: 'Manage Claude connection' }).waitFor();
  expect(await claudeCard.getAttribute('class')).toContain('border-tp-primary');
  expect(await claudeCard.getByRole('button', { name: 'Manage Claude connection' }).textContent()).toContain('Connected');
  await openaiCard.getByRole('button', { name: 'Connect ChatGPT & Codex', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect ChatGPT & Codex to SPHERE' }).waitFor();
  const codex = await connect('Codex');
  await settings();
  await openaiCard.getByRole('button', { name: 'Manage ChatGPT & Codex connection' }).waitFor();
  await settle();
  await page.getByRole('region', { name: 'Connected applications', exact: true }).screenshot({ path: screenshotDir + '/02-connected.png' });

  const sdk = new Client({ name: 'settings-browser-e2e', version: '1' });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(apiOrigin + '/api/v1/orbit/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + claude.access } } }));
  try {
    expect(JSON.stringify(await sdk.callTool({ name: 'list_my_organizations', arguments: {} }))).toContain(firstOrg.id);
    await claudeCard.hover();
    await claudeCard.getByRole('button', { name: 'Edit Claude connection' }).click();
    await page.getByRole('heading', { name: 'Claude', exact: true }).waitFor();
    await page.getByRole('button', { name: 'View Only', exact: true }).click();
    await page.getByRole('button', { name: 'Save permissions', exact: true }).click();
    await page.getByText('Permissions updated.', { exact: false }).waitFor();
    const denied = await sdk.callTool({ name: 'propose_plan', arguments: { summary: 'Read only', organizations: [] } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain('only has VIEW');
    await claudeCard.getByRole('button', { name: 'Manage Claude connection' }).click();
    await page.getByRole('button', { name: 'Remove ' + firstOrg.displayName, exact: true }).click();
    expect(await page.getByRole('button', { name: 'Save permissions' }).isDisabled()).toBe(true);
    await page.getByRole('textbox', { name: 'Search organizations' }).fill(secondOrg.displayName);
    await page.getByRole('button', { name: new RegExp(secondOrg.displayName) }).click();
    await page.getByRole('button', { name: 'Management', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Management', exact: true }).getAttribute('aria-pressed')).toBe('true');
    // Returning from the assistant must not reset an unsaved permissions draft.
    const refreshed = page.waitForResponse(response => response.url().endsWith('/oauth/grants') && response.request().method() === 'GET');
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await refreshed;
    expect(await page.getByRole('button', { name: 'Management', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await settle();
    await page.screenshot({ path: screenshotDir + '/03-edit-permissions.png', fullPage: true });
    await page.getByRole('button', { name: 'Save permissions', exact: true }).click();
    await page.getByText('Permissions updated.', { exact: false }).waitFor();
    const organizations = JSON.stringify(await sdk.callTool({ name: 'list_my_organizations', arguments: {} }));
    expect(organizations).toContain(secondOrg.id);
    expect(organizations).not.toContain(firstOrg.id);
    const grant = await OAuthGrant.findOne({ clientId: claude.clientId }).lean();
    expect(grant!.scopes).toEqual([{ organizationId: secondOrg.id, scope: 'MANAGEMENT' }]);
    expect((await OAuthGrant.findOne({ clientId: codex.clientId }).lean())!.scopes).toEqual([{ organizationId: firstOrg.id, scope: 'ALL' }]);
    await claudeCard.getByRole('button', { name: 'Manage Claude connection' }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm disconnect', exact: true }).click();
    await claudeCard.getByRole('button', { name: 'Connect Claude', exact: true }).waitFor();
    await request(app).post('/api/v1/orbit/mcp').auth(claude.access, { type: 'bearer' }).send({}).expect(401);
    await openaiCard.getByRole('button', { name: 'Manage ChatGPT & Codex connection' }).waitFor();
  } finally { await sdk.close(); }
  // Responsive and dark-mode verification use the actual rendered settings page.
  await page.evaluate("localStorage.setItem('sphere-theme', 'dark')");
  await settings();
  await page.waitForFunction("document.documentElement.classList.contains('dark')");
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  await page.screenshot({ path: screenshotDir + '/04-mobile-dark.png', fullPage: true });
  expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  await page.goto(origin + '/me/api-keys');
  await page.getByRole('heading', { name: 'API Keys', exact: true }).waitFor();
  expect(await page.getByText('Use ORBIT from an AI assistant (MCP)', { exact: true }).count()).toBe(0);
});
