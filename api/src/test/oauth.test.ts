import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import testContainer from './utils/config/testContainer';
import { shutdownApp } from './utils/testApp';
import { BASE_PATH } from './utils/config/variables';
import { createAndLoginUser } from './utils/users/userTestUtils';
import { cleanupOrganization } from './utils/organizations/organizationTestUtils';
import UserMongoose from '../main/repositories/mongoose/models/UserMongoose';
import { OAuthClient, OAuthGrant, OAuthToken } from '../main/repositories/mongoose/models/OAuthMongoose';
import { hashOAuthToken, oauthIssuer, oauthResource } from '../main/services/OAuthService';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import container from '../main/config/container';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens, OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js';

describe('ORBIT MCP OAuth', () => {
  const app = testContainer.resolve('app');
  const base = BASE_PATH + '/oauth';
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  let user: any;
  let organizationId: string;
  let otherOrganizationId: string;
  let otherUser: any;
  const clients: string[] = [];

  beforeAll(async () => {
    ({ user, organizationId } = await createAndLoginUser('USER', 'oauth_' + Date.now()));
    ({ user: otherUser, organizationId: otherOrganizationId } = await createAndLoginUser('USER', 'oauth_other_' + Date.now()));
  });
  afterAll(async () => {
    const grants = await OAuthGrant.find({ userId: user.id }).lean();
    await OAuthToken.deleteMany({ grantId: { $in: grants.map(g => String(g._id)) } });
    await OAuthGrant.deleteMany({ userId: user.id });
    await OAuthClient.deleteMany({ client_id: { $in: clients } });
    await cleanupOrganization(organizationId);
    await cleanupOrganization(otherOrganizationId);
    await UserMongoose.deleteMany({ _id: { $in: [user.id, otherUser.id] } });
    await shutdownApp();
  });

  async function register(redirectUri = redirect) {
    const result = await request(app).post(base + '/register').send({
      client_name: 'OAuth integration client', redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    });
    expect(result.status).toBe(201);
    clients.push(result.body.client_id);
    return result.body;
  }

  async function authorize(client: any, options: Record<string, string | undefined> = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const result = await request(app).get(base + '/authorize').query({ client_id: client.client_id,
      redirect_uri: client.redirect_uris[0], response_type: 'code', code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource: oauthResource(), state: 'test-state', ...options });
    return { result, verifier, requestId: result.headers.location?.includes('/oauth/consent') ? new URL(result.headers.location).searchParams.get('request') : null };
  }

  async function code(client: any, scope = 'VIEW') {
    const auth = await authorize(client);
    expect(auth.result.status).toBe(302);
    const info = await request(app).get(base + '/requests/' + auth.requestId).auth(user.token, { type: 'bearer' });
    expect(info.status).toBe(200);
    expect(info.body.redirectDomain).toBe(new URL(client.redirect_uris[0]).host);
    const decision = await request(app).post(base + '/requests/' + auth.requestId).auth(user.token, { type: 'bearer' })
      .send({ approve: true, scopes: [{ organizationId, scope }] });
    expect(decision.status).toBe(200);
    const callback = new URL(decision.body.redirectUrl);
    expect(callback.searchParams.get('state')).toBe('test-state');
    return { code: callback.searchParams.get('code'), code_verifier: auth.verifier, redirect_uri: client.redirect_uris[0],
      client_id: client.client_id, grant_type: 'authorization_code', resource: oauthResource() };
  }
  async function connection(scope = 'VIEW') {
    const client = await register();
    const exchange = await code(client, scope);
    const tokens = await request(app).post(base + '/token').type('form').send(exchange);
    expect(tokens.status).toBe(200);
    return { client, exchange, tokens: tokens.body };
  }
  const refresh = (clientId: string, token: string, resource = oauthResource()) => request(app).post(base + '/token').type('form')
    .send({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token, resource });
  const mcp = (token: string) => request(app).post(BASE_PATH + '/orbit/mcp').auth(token, { type: 'bearer' })
    .set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

  it('publishes discovery and a Bearer challenge on missing or invalid credentials', async () => {
    const missing = await request(app).post(BASE_PATH + '/orbit/mcp').send({});
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toContain('resource_metadata="' + oauthIssuer());
    const invalid = await mcp('sph_oat_invalid');
    expect(invalid.status).toBe(401);
    expect(invalid.headers['www-authenticate']).toContain('resource_metadata=');
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/orbit/mcp']) {
      const metadata = await request(app).get(path);
      expect(metadata.status).toBe(200);
      expect(metadata.body.resource).toBe(oauthResource());
      expect(metadata.body.authorization_servers).toEqual([oauthIssuer()]);
    }
    const metadata = await request(app).get('/.well-known/oauth-authorization-server');
    expect(metadata.status).toBe(200);
    expect(metadata.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.body.token_endpoint_auth_methods_supported).toContain('none');
  });

  it('registers public clients and rejects unsafe redirects', async () => {
    await register('http://127.0.0.1:49500/callback');
    for (const uri of ['http://evil.example/callback', 'javascript:alert(1)', 'https://example.com/#fragment', 'https://example.com/*']) {
      const result = await request(app).post(base + '/register').send({ redirect_uris: [uri], token_endpoint_auth_method: 'none' });
      expect(result.status).toBe(400);
    }
  });

  it('completes PKCE, calls MCP through a real SDK client, rotates refresh and revokes replay', async () => {
    const { client, tokens } = await connection();
    expect(tokens.access_token).toMatch(/^sph_oat_/);
    const address = (app as Server).address() as AddressInfo;
    const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${address.port}${BASE_PATH}/orbit/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer ' + tokens.access_token } } });
    const sdk = new Client({ name: 'oauth-test', version: '1' });
    await sdk.connect(transport);
    expect((await sdk.listTools()).tools.length).toBeGreaterThan(0);
    const organizations = await sdk.callTool({ name: 'list_my_organizations', arguments: {} });
    const text = JSON.stringify(organizations);
    expect(text).toContain(organizationId);
    expect(text).not.toContain(otherOrganizationId);
    const write = await sdk.callTool({ name: 'propose_plan', arguments: { summary: 'Denied', organizations: [] } });
    expect(write.isError).toBe(true);
    await sdk.close();
    expect((await request(app).get(BASE_PATH + '/oauth/grants').auth(tokens.access_token, { type: 'bearer' })).status).toBe(401);
    const rotated = await refresh(client.client_id, tokens.refresh_token);
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(tokens.refresh_token);
    expect((await refresh(client.client_id, tokens.refresh_token)).status).toBe(400);
    expect((await mcp(rotated.body.access_token)).status).toBe(401);
  });

  it('rejects absent/plain PKCE, redirect mismatch and wrong audience', async () => {
    const client = await register();
    for (const patch of [{ code_challenge_method: 'plain' }, { code_challenge: '' }, { resource: 'https://other.example/mcp' }]) {
      const auth = await authorize(client, patch);
      expect(auth.requestId).toBeNull();
    }
    const auth = await authorize(client, { redirect_uri: 'https://evil.example/callback' });
    expect(auth.result.status).toBe(400);
    const exchange = await code(client);
    for (const patch of [{ code_verifier: 'wrong' }, { redirect_uri: 'https://evil.example/callback' }, { resource: 'https://other.example/mcp' }]) {
      expect((await request(app).post(base + '/token').type('form').send({ ...exchange, ...patch })).status).toBe(400);
    }
    const good = await request(app).post(base + '/token').type('form').send(exchange);
    expect(good.status).toBe(200);
    expect((await request(app).post(base + '/token').type('form').send(exchange)).status).toBe(400);
    expect((await refresh(client.client_id, good.body.refresh_token, 'https://other.example/mcp')).status).toBe(400);
    await OAuthToken.updateOne({ hash: createHash('sha256').update(good.body.access_token).digest('hex') }, { resource: 'https://other.example/mcp' });
    expect((await mcp(good.body.access_token)).status).toBe(401);
  });

  it('uses SDK OAuth auth for discovery, DCR, PKCE and token exchange', async () => {
    let info: OAuthClientInformationMixed | undefined;
    let tokens: OAuthTokens | undefined;
    let verifier = '';
    let returnedCode = '';
    const provider: OAuthClientProvider = {
      redirectUrl: redirect,
      clientMetadata: { client_name: 'SDK OAuth client', redirect_uris: [redirect], token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
      clientInformation: () => info,
      saveClientInformation: value => { info = value; clients.push(value.client_id); },
      tokens: () => tokens,
      saveTokens: value => { tokens = value; },
      saveCodeVerifier: value => { verifier = value; },
      codeVerifier: () => verifier,
      redirectToAuthorization: async url => {
        const pending = await request(app).get(url.pathname + url.search);
        expect(pending.status).toBe(302);
        const requestId = new URL(pending.headers.location).searchParams.get('request');
        const approved = await request(app).post(base + '/requests/' + requestId).auth(user.token, { type: 'bearer' })
          .send({ approve: true, scopes: [{ organizationId, scope: 'VIEW' }] });
        expect(approved.status).toBe(200);
        returnedCode = new URL(approved.body.redirectUrl).searchParams.get('code')!;
      },
    };
    const address = (app as Server).address() as AddressInfo;
    // Keep the public resource/issuer unchanged while routing HTTP to the isolated test API.
    const fetchFn: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe(oauthIssuer());
      return fetch(`http://localhost:${address.port}${url.pathname}${url.search}`, init);
    };
    expect(await auth(provider, { serverUrl: oauthResource(), fetchFn })).toBe('REDIRECT');
    expect(returnedCode).toBeTruthy();
    expect(await auth(provider, { serverUrl: oauthResource(), authorizationCode: returnedCode, fetchFn })).toBe('AUTHORIZED');
    expect((await mcp(tokens!.access_token)).status).toBe(200);
  });

  it('binds consent to its user, supports denial, and prevents selecting another organization', async () => {
    const client = await register();
    const { requestId } = await authorize(client);
    await request(app).get(base + '/requests/' + requestId).auth(user.token, { type: 'bearer' }).expect(200);
    await request(app).get(base + '/requests/' + requestId).auth(otherUser.token, { type: 'bearer' }).expect(404);
    await request(app).post(base + '/requests/' + requestId).auth(user.token, { type: 'bearer' })
      .send({ approve: true, scopes: [{ organizationId: otherOrganizationId, scope: 'ALL' }] }).expect(403);
    const denied = await request(app).post(base + '/requests/' + requestId).auth(user.token, { type: 'bearer' }).send({ approve: false });
    expect(new URL(denied.body.redirectUrl).searchParams.get('error')).toBe('access_denied');
    await request(app).post(base + '/requests/' + requestId).auth(user.token, { type: 'bearer' }).send({ approve: false }).expect(404);
  });

  it('creates the connection only when the code is exchanged', async () => {
    const client = await register();
    const exchange = await code(client);
    expect(await OAuthGrant.countDocuments({ clientId: client.client_id })).toBe(0);
    expect((await request(app).post(base + '/token').type('form').send(exchange)).status).toBe(200);
    const grant = await OAuthGrant.findOne({ clientId: client.client_id }).lean();
    expect(grant).toMatchObject({ userId: user.id, revoked: false, scopes: [{ organizationId, scope: 'VIEW' }] });
  });

  it('atomically consumes authorization codes and detects concurrent refresh replay', async () => {
    const client = await register();
    const exchange = await code(client);
    const exchanged = await Promise.all([0, 1].map(() => request(app).post(base + '/token').type('form').send(exchange)));
    expect(exchanged.filter(result => result.status === 200)).toHaveLength(1);
    expect(exchanged.filter(result => result.status === 400)).toHaveLength(1);
    const token = exchanged.find(result => result.status === 200)!.body.refresh_token;
    const rotated = await Promise.all([refresh(client.client_id, token), refresh(client.client_id, token)]);
    expect(rotated.filter(result => result.status === 200).length).toBeLessThanOrEqual(1);
    expect(rotated.some(result => result.status === 400)).toBe(true);
    const grant = await OAuthGrant.findOne({ clientId: client.client_id }).lean();
    expect(grant!.revoked).toBe(true);
  });

  it('keeps OAuth entries out of the public cache endpoint', async () => {
    const client = await register();
    const verifier = randomBytes(32).toString('base64url');
    const forged = randomBytes(32).toString('base64url');
    const approval = { clientId: client.client_id, clientName: 'Forged', redirectUri: redirect,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'), resource: oauthResource(),
      userId: otherUser.id, scopes: [{ organizationId: otherOrganizationId, scope: 'ALL' }] };
    const key = ' OAuth:code:' + hashOAuthToken(forged);
    const written = await request(app).post(BASE_PATH + '/cache').set('X-Origin', 'http://localhost')
      .send({ key, value: approval, expirationInSeconds: 300 });
    expect(written.status).toBe(403);
    const read = await request(app).get(BASE_PATH + '/cache').set('X-Origin', 'http://localhost').query({ key });
    expect(read.status).toBe(403);
    const exchanged = await request(app).post(base + '/token').type('form').send({ grant_type: 'authorization_code',
      code: forged, code_verifier: verifier, redirect_uri: redirect, client_id: client.client_id, resource: oauthResource() });
    expect(exchanged.status).toBe(400);
    expect(await OAuthGrant.countDocuments({ clientId: client.client_id })).toBe(0);
  });

  it('revokes through RFC 7009 only for the owning client and rejects expired tokens', async () => {
    const first = await connection();
    const other = await register();
    await request(app).post(base + '/revoke').type('form').send({ client_id: other.client_id, token: first.tokens.access_token }).expect(200);
    expect((await mcp(first.tokens.access_token)).status).toBe(200);
    await request(app).post(base + '/revoke').type('form').send({ client_id: first.client.client_id, token: first.tokens.access_token }).expect(200);
    expect((await mcp(first.tokens.access_token)).status).toBe(401);
    const next = await connection();
    await OAuthToken.updateOne({ hash: createHash('sha256').update(next.tokens.access_token).digest('hex') }, { expiresAt: new Date(0) });
    expect((await mcp(next.tokens.access_token)).status).toBe(401);
    await OAuthGrant.updateOne({ clientId: next.client.client_id }, { expiresAt: new Date(0) });
    expect((await refresh(next.client.client_id, next.tokens.refresh_token)).status).toBe(400);
  });

  it('lists safe grant data and immediately revokes access and refresh', async () => {
    const { client, tokens } = await connection();
    const listed = await request(app).get(base + '/grants').auth(user.token, { type: 'bearer' });
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain('refreshHash');
    const grant = await OAuthGrant.findOne({ clientId: client.client_id }).lean();
    await request(app).delete(base + '/grants/' + grant!._id).auth(otherUser.token, { type: 'bearer' }).expect(404);
    await request(app).delete(base + '/grants/' + grant!._id).auth(user.token, { type: 'bearer' }).expect(204);
    expect((await mcp(tokens.access_token)).status).toBe(401);
    expect((await refresh(client.client_id, tokens.refresh_token)).status).toBe(400);
  });

  it('rejects confirming plans from another credential, including legacy API keys', async () => {
    const first = await connection('ALL');
    const second = await connection('ALL');
    const service = container.resolve('oauthService');
    const firstAuth = await service.authenticate(first.tokens.access_token);
    const secondAuth = await service.authenticate(second.tokens.access_token);
    // Exercise the real MCP confirmation guard before any plan execution.
    const orbit = container.resolve('orbitService');
    const conversation = await orbit.createConversation({ id: user.id, username: user.username, role: user.role });
    const plan = await container.resolve('orbitPlanRepository').create({ userId: user.id, conversationId: conversation.id,
      source: 'mcp', summary: 'Credential isolation', credentialId: firstAuth.credential._id, steps: [], warnings: [], ignoredRows: [] });
    const address = (app as Server).address() as AddressInfo;
    const sdk = new Client({ name: 'credential-isolation', version: '1' });
    await sdk.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${address.port}${BASE_PATH}/orbit/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer ' + second.tokens.access_token } } }));
    const result = await sdk.callTool({ name: 'confirm_plan', arguments: { planId: plan.id } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('not proposed');
    expect(secondAuth.credential._id).not.toBe(firstAuth.credential._id);
    const legacyPlan = await container.resolve('orbitPlanRepository').create({ userId: user.id, conversationId: conversation.id,
      source: 'mcp', summary: 'Legacy key isolation', apiKeyId: secondAuth.credential._id.replace('oauth:', ''), steps: [], warnings: [], ignoredRows: [] });
    const legacyResult = await sdk.callTool({ name: 'confirm_plan', arguments: { planId: legacyPlan.id } });
    expect(legacyResult.isError).toBe(true);
    expect(JSON.stringify(legacyResult)).toContain('not proposed');
    await sdk.close();
  });

  it('rate limits invalid token requests and DCR attempts', async () => {
    let tokenStatus = 0;
    for (let i = 0; i < 51 && tokenStatus !== 429; i++) {
      tokenStatus = (await request(app).post(base + '/token').type('form').send({ grant_type: 'authorization_code', code_verifier: 'short' })).status;
    }
    expect(tokenStatus).toBe(429);
    let registrationStatus = 0;
    for (let i = 0; i < 21 && registrationStatus !== 429; i++) {
      registrationStatus = (await request(app).post(base + '/register').send({})).status;
    }
    expect(registrationStatus).toBe(429);
  });
});
