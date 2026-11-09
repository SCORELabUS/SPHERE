import { createHash, generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { shutdownApp } from './utils/testApp';
import User from '../main/repositories/mongoose/models/UserMongoose';
import { oauthIssuer } from '../main/services/OAuthService';

if (process.env.DATABASE_NAME !== 'sphere_scratch' || process.env.MONGO_PORT !== '27018' || process.env.REDIS_URL !== 'redis://127.0.0.1:6378') {
  throw new Error('OIDC integration tests require sphere_scratch, Mongo 27018 and Redis 6378');
}
const { default: testContainer } = await import('./utils/config/testContainer');
const { createAndLoginUser } = await import('./utils/users/userTestUtils');
const { cleanupOrganization } = await import('./utils/organizations/organizationTestUtils');

describe('SPHERE identity provider, isolated from MCP', () => {
  const app = testContainer.resolve('app');
  const base = '/api/v1/oidc';
  const callback = 'http://127.0.0.1:5184/api/v1/auth/sphere/callback';
  const icanCallback = 'http://127.0.0.1:8080/api/v1/users/auth/sso/sphere/callback';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let user: any, organizationId: string;
  beforeAll(async () => {
    vi.stubEnv('OIDC_SPACE_CLIENT_ID', 'space-test'); vi.stubEnv('OIDC_SPACE_CLIENT_SECRET', 'space-test-secret');
    vi.stubEnv('OIDC_SPACE_REDIRECT_URI', callback); vi.stubEnv('OIDC_SIGNING_PRIVATE_KEY', privateKey);
    vi.stubEnv('OIDC_ICAN_CLIENT_ID', 'ican-test'); vi.stubEnv('OIDC_ICAN_CLIENT_SECRET', 'ican-test-secret');
    vi.stubEnv('OIDC_ICAN_REDIRECT_URI', icanCallback);
    ({ user, organizationId } = await createAndLoginUser('USER', 'identity_' + Date.now()));
  });
  afterAll(async () => {
    await cleanupOrganization(organizationId); await User.deleteOne({ _id: user.id });
    vi.unstubAllEnvs(); await shutdownApp();
  });
  async function authorize(overrides = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const response = await request(app).get(base + '/authorize').query({ client_id: 'space-test', redirect_uri: callback,
      response_type: 'code', scope: 'openid profile', state: 'state-with-enough-entropy', nonce: 'nonce-with-enough-entropy',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), ...overrides });
    return { response, verifier, id: response.headers.location ? new URL(response.headers.location).searchParams.get('request') : null };
  }
  async function code() {
    const auth = await authorize(); expect(auth.response.status).toBe(302);
    const decision = await request(app).post(base + '/requests/' + auth.id).auth(user.token, { type: 'bearer' }).send({ approve: true });
    expect(decision.status).toBe(200);
    const redirect = new URL(decision.body.redirectUrl); expect(redirect.searchParams.get('state')).toBe('state-with-enough-entropy');
    return { grant_type: 'authorization_code', client_id: 'space-test', client_secret: 'space-test-secret',
      redirect_uri: callback, code: redirect.searchParams.get('code'), code_verifier: auth.verifier };
  }
  it('publishes OIDC discovery and public-only keys without changing MCP discovery', async () => {
    const metadata = await request(app).get('/.well-known/openid-configuration').expect(200);
    expect(metadata.body.issuer).toBe(oauthIssuer()); expect(metadata.body.scopes_supported).toEqual(['openid', 'profile', 'email']);
    const keys = (await request(app).get(base + '/jwks').expect(200)).body.keys;
    expect(keys[0].d).toBeUndefined(); expect(createPublicKey({ key: keys[0], format: 'jwk' }).export({ type: 'spki', format: 'pem' })).toBe(publicKey);
    expect((await request(app).get('/.well-known/oauth-authorization-server').expect(200)).body.scopes_supported).toEqual(['orbit']);
  });
  it('rejects unregistered callbacks, MCP scopes and missing nonce', async () => {
    expect((await authorize({ redirect_uri: 'https://attacker.example/callback' })).response.status).toBe(400);
    expect((await authorize({ scope: 'openid orbit' })).response.status).toBe(400);
    expect((await authorize({ nonce: '' })).response.status).toBe(400);
  });
  it('requires a web session to read consent and permits denial without organizations', async () => {
    const auth = await authorize();
    await request(app).get(base + '/requests/' + auth.id).expect(401);
    const info = await request(app).get(base + '/requests/' + auth.id).auth(user.token, { type: 'bearer' }).expect(200);
    expect(info.body.scopes).toEqual(['openid', 'profile']);
    const denied = await request(app).post(base + '/requests/' + auth.id).auth(user.token, { type: 'bearer' }).send({ approve: false }).expect(200);
    expect(new URL(denied.body.redirectUrl).searchParams.get('error')).toBe('access_denied');
    await request(app).post(base + '/requests/' + auth.id).auth(user.token, { type: 'bearer' }).send({ approve: true }).expect(400);
  });
  it('validates client, callback and PKCE, signs the stable subject and consumes the code once', async () => {
    const body = await code();
    await request(app).post(base + '/token').type('form').send({ ...body, client_secret: 'wrong' }).expect(401);
    await request(app).post(base + '/token').type('form').send({ ...body, code_verifier: randomBytes(32).toString('hex') }).expect(400);
    await request(app).post(base + '/token').type('form').send({ ...body, redirect_uri: callback + '/wrong' }).expect(400);
    const tokens = await request(app).post(base + '/token').type('form').send(body).expect(200);
    expect(tokens.headers['cache-control']).toBe('no-store');
    const claims = jwt.verify(tokens.body.id_token, publicKey, { algorithms: ['RS256'], issuer: oauthIssuer(), audience: 'space-test' }) as jwt.JwtPayload;
    expect(claims.sub).toBe(user.id); expect(claims.nonce).toBe('nonce-with-enough-entropy');
    expect(claims.preferred_username).toBe(user.username); expect(claims.email).toBeUndefined(); expect(claims.role).toBeUndefined();
    await request(app).post(base + '/token').type('form').send(body).expect(400);
    const info = await request(app).get(base + '/userinfo').auth(tokens.body.access_token, { type: 'bearer' }).expect(200);
    expect(info.body.sub).toBe(user.id); expect(info.body.role).toBeUndefined();
    await request(app).post('/api/v1/orbit/mcp').auth(tokens.body.access_token, { type: 'bearer' }).send({}).expect(401);
    await request(app).get(base + '/userinfo').auth('sph_oat_fake', { type: 'bearer' }).expect(401);
    await request(app).get(base + '/userinfo').auth(user.token, { type: 'bearer' }).expect(401);
  });
  it('allows only one concurrent exchange of a code', async () => {
    const body = await code();
    const responses = await Promise.all([1, 2].map(() => request(app).post(base + '/token').type('form').send(body)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
  });
  describe('a second registered client (ICAN)', () => {
    const ican = { client_id: 'ican-test', redirect_uri: icanCallback, scope: 'openid profile email' };
    async function icanCode() {
      const auth = await authorize(ican); expect(auth.response.status).toBe(302);
      const decision = await request(app).post(base + '/requests/' + auth.id).auth(user.token, { type: 'bearer' }).send({ approve: true }).expect(200);
      const redirect = new URL(decision.body.redirectUrl);
      expect(redirect.origin + redirect.pathname).toBe(icanCallback);
      return { grant_type: 'authorization_code', client_id: 'ican-test', client_secret: 'ican-test-secret',
        redirect_uri: icanCallback, code: redirect.searchParams.get('code'), code_verifier: auth.verifier };
    }
    it('names each application on its consent request', async () => {
      const icanAuth = await authorize(ican);
      const icanInfo = await request(app).get(base + '/requests/' + icanAuth.id).auth(user.token, { type: 'bearer' }).expect(200);
      expect(icanInfo.body).toEqual({ clientName: 'ICAN', redirectDomain: '127.0.0.1:8080', scopes: ['openid', 'profile', 'email'] });
      const spaceAuth = await authorize();
      const spaceInfo = await request(app).get(base + '/requests/' + spaceAuth.id).auth(user.token, { type: 'bearer' }).expect(200);
      expect(spaceInfo.body.clientName).toBe('SPACE');
    });
    it('only accepts the callback each client registered', async () => {
      expect((await authorize({ ...ican, redirect_uri: callback })).response.status).toBe(400);
      expect((await authorize({ redirect_uri: icanCallback })).response.status).toBe(400);
      expect((await authorize({ ...ican, client_id: 'unregistered' })).response.status).toBe(400);
    });
    it('issues ICAN tokens for ICAN only, with the email and names it asked for', async () => {
      const body = await icanCode();
      await request(app).post(base + '/token').type('form').send({ ...body, client_id: 'space-test', client_secret: 'space-test-secret' }).expect(400);
      await request(app).post(base + '/token').type('form').send({ ...body, client_secret: 'space-test-secret' }).expect(401);
      await request(app).post(base + '/token').type('form').send({ ...body, client_id: 'space-test', client_secret: 'space-test-secret', redirect_uri: callback }).expect(400);
      const tokens = await request(app).post(base + '/token').type('form').send(body).expect(200);
      const claims = jwt.verify(tokens.body.id_token, publicKey, { algorithms: ['RS256'], issuer: oauthIssuer(), audience: 'ican-test' }) as jwt.JwtPayload;
      expect(claims.sub).toBe(user.id); expect(claims.aud).toBe('ican-test');
      expect(claims).toMatchObject({ preferred_username: user.username, email: user.email, given_name: user.firstName, family_name: user.lastName });
      expect(() => jwt.verify(tokens.body.id_token, publicKey, { algorithms: ['RS256'], audience: 'space-test' })).toThrow();
    });
    it('a SPACE code cannot be exchanged by ICAN', async () => {
      const body = await code();
      await request(app).post(base + '/token').type('form').send({ ...body, client_id: 'ican-test', client_secret: 'ican-test-secret' }).expect(400);
      await request(app).post(base + '/token').type('form').send({ ...body, client_id: 'ican-test', client_secret: 'ican-test-secret', redirect_uri: icanCallback }).expect(400);
      await request(app).post(base + '/token').type('form').send(body).expect(200);
    });
    it('works with ICAN alone, and stops when a client loses its settings', async () => {
      vi.stubEnv('OIDC_SPACE_CLIENT_SECRET', '');
      try {
        await request(app).get('/.well-known/openid-configuration').expect(200);
        expect((await authorize()).response.status).toBe(400);
        const pending = await authorize(ican);
        vi.stubEnv('OIDC_ICAN_CLIENT_SECRET', '');
        await request(app).get('/.well-known/openid-configuration').expect(503);
        vi.stubEnv('OIDC_SPACE_CLIENT_SECRET', 'space-test-secret');
        await request(app).get(base + '/requests/' + pending.id).auth(user.token, { type: 'bearer' }).expect(400);
      } finally {
        vi.stubEnv('OIDC_SPACE_CLIENT_SECRET', 'space-test-secret'); vi.stubEnv('OIDC_ICAN_CLIENT_SECRET', 'ican-test-secret');
      }
    });
    it('binds a code to its client even when two clients share a callback', async () => {
      vi.stubEnv('OIDC_ICAN_REDIRECT_URI', callback);
      try {
        const body = await code();
        await request(app).post(base + '/token').type('form').send({ ...body, client_id: 'ican-test', client_secret: 'ican-test-secret' }).expect(400);
        await request(app).post(base + '/token').type('form').send(body).expect(200);
      } finally { vi.stubEnv('OIDC_ICAN_REDIRECT_URI', icanCallback); }
    });
    it('leaves out a client with an invalid callback without stopping the others', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubEnv('OIDC_ICAN_REDIRECT_URI', 'http://ican.example.com/callback');
      try {
        await request(app).get('/.well-known/openid-configuration').expect(200);
        expect((await authorize()).response.status).toBe(302);
        expect((await authorize(ican)).response.status).toBe(400);
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('OIDC_ICAN_REDIRECT_URI'));
      } finally { vi.stubEnv('OIDC_ICAN_REDIRECT_URI', icanCallback); errors.mockRestore(); }
    });
    it('refuses two clients with the same client ID', async () => {
      vi.stubEnv('OIDC_ICAN_CLIENT_ID', 'space-test');
      try {
        await request(app).get('/.well-known/openid-configuration').expect(503);
        expect((await authorize()).response.status).toBe(503);
      } finally { vi.stubEnv('OIDC_ICAN_CLIENT_ID', 'ican-test'); }
    });
  });
  it('keeps identity state inaccessible through the cache API', async () => {
    await request(app).get('/api/v1/cache').set('x-origin', 'http://localhost').query({ key: 'oidc:code:any' }).expect(403);
  });
});
