import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT, type KeyLike, type JWK } from 'jose';
import express from 'express';
import request from 'supertest';
vi.mock('../../main/config/container', () => ({ default: { resolve: vi.fn() } }));
import container from '../../main/config/container';
import ScoretechIdentityService, {
  scoretechIdentityId,
} from '../../main/services/ScoretechIdentityService';
import ScoretechIdentityController, {
  identityModePolicy,
} from '../../main/controllers/ScoretechIdentityController';
import { authenticationMiddleware } from '../../main/middlewares/AuthenticationMiddleware';
import { generateJwtToken } from '../../main/utils/users/helpers';
import {
  authenticationConfig,
  safeReturnTo,
  validateAuthenticationConfig,
} from '../../main/services/scoretech/config';

const user = {
  id: 'account-1',
  username: 'researcher',
  role: 'USER',
  firstName: 'Test',
  lastName: 'Researcher',
  email: 'me@example.test',
};
let server: Server;
let issuer: string;
let privateKey: KeyLike;
let jwk: JWK;
let nonce = '';
let challenge = '';
let badNonce = false;
let wrongAudience = false;
let down = false;
let revoked = false;
let grants = 0;
let cache: Map<string, any>;
let service: ScoretechIdentityService;
let provider: {
  findOrCreateUser: ReturnType<typeof vi.fn>;
  linkIdentity: ReturnType<typeof vi.fn>;
};
let replace: ReturnType<typeof vi.fn>;
const env = { ...process.env };
beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  jwk = await exportJWK(keys.publicKey);
  jwk.kid = 'fixture';
  jwk.alg = 'RS256';
  server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/.well-known/openid-configuration'))
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + '/protocol/openid-connect/auth',
          token_endpoint: issuer + '/protocol/openid-connect/token',
          jwks_uri: issuer + '/certs',
          end_session_endpoint: issuer + '/logout',
        })
      );
    if (req.url?.endsWith('/certs')) return res.end(JSON.stringify({ keys: [jwk] }));
    if (req.url?.endsWith('/logout')) {
      res.statusCode = 204;
      return res.end();
    }
    if (down) {
      res.statusCode = 503;
      return res.end('{}');
    }
    const chunks: Buffer[] = [];
    for await (const data of req) chunks.push(Buffer.from(data));
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    grants++;
    if (revoked || body.get('client_secret') !== 'fixture-secret') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
    if (
      body.get('grant_type') === 'authorization_code' &&
      createHash('sha256')
        .update(body.get('code_verifier') || '')
        .digest('base64url') !== challenge
    ) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'invalid_grant' }));
    }
    const access = await new SignJWT({ azp: 'sphere', email: user.email })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(issuer)
      .setSubject('central-subject')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const id = await new SignJWT({
      nonce: badNonce ? 'wrong' : nonce,
      email: user.email,
      given_name: 'Test',
      family_name: 'Researcher',
      email_verified: true,
      roles: ['administrador'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer(issuer)
      .setSubject('central-subject')
      .setAudience(wrongAudience ? 'wrong' : 'sphere')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    res.end(
      JSON.stringify({
        access_token: access,
        id_token: id,
        refresh_token: 'fixture-refresh-' + grants,
        expires_in: 300,
        refresh_expires_in: 43200,
      })
    );
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No listener');
  issuer = `http://127.0.0.1:${address.port}/realms/score`;
});
afterAll(async () => {
  process.env = env;
  await new Promise<void>(resolve => server.close(() => resolve()));
});
beforeEach(() => {
  vi.restoreAllMocks();
  badNonce = false;
  wrongAudience = false;
  down = false;
  revoked = false;
  grants = 0;
  cache = new Map();
  Object.assign(process.env, {
    AUTH_PROVIDER: 'scoretech',
    SCORETECH_IDENTITY_ISSUER: issuer,
    SCORETECH_IDENTITY_CLIENT_ID: 'sphere',
    SCORETECH_IDENTITY_CLIENT_SECRET: 'fixture-secret',
    FRONTEND_URL: 'http://localhost:5173',
    BASE_URL_PATH: '',
  });
  delete process.env.SCORETECH_IDENTITY_TRANSPORT_URL;
  delete process.env.SCORETECH_IDENTITY_CALLBACK_URL;
  replace = vi.fn(async (key, value, _ttl, onlyExisting = false) => {
    if (onlyExisting && !cache.has(key)) return false;
    cache.set(key, value);
    return true;
  });
  const store = {
    get: vi.fn(async key => cache.get(key) || null),
    set: vi.fn(async (key, value) => {
      cache.set(key, value);
    }),
    take: vi.fn(async key => {
      const value = cache.get(key);
      cache.delete(key);
      return value;
    }),
    del: vi.fn(async key => {
      cache.delete(key);
    }),
    replacePrivate: replace,
    setIfAbsent: vi.fn(async (key, value) => {
      if (cache.has(key)) return false;
      cache.set(key, value);
      return true;
    }),
  };
  provider = {
    findOrCreateUser: vi.fn(async () => ({ token: 'unused', user })),
    linkIdentity: vi.fn(async () => ({})),
  };
  (container.resolve as any).mockImplementation(
    (name: string) =>
      ({
        cacheService: store,
        userRepository: { findById: vi.fn(async () => user) },
        authProviderService: provider,
        scoretechIdentityService: service,
      })[name]
  );
  service = new ScoretechIdentityService();
});
async function begin() {
  const flow = await service.begin('/me/settings?section=applications', false);
  const url = new URL(flow.url);
  nonce = url.searchParams.get('nonce')!;
  challenge = url.searchParams.get('code_challenge')!;
  return flow;
}
async function connected() {
  const flow = await begin();
  return (await service.complete(flow.state, flow.binding, 'fixture-code')).sessionId!;
}
function app() {
  const value = express();
  value.use(express.json());
  const controller = new ScoretechIdentityController();
  value.get('/config', controller.config);
  value.get('/callback', controller.callback);
  value.get('/login', controller.login);
  value.post('/session', controller.session);
  value.post('/logout', controller.logout);
  value.use(identityModePolicy);
  value.post('/api/v1/users/login', (_req, res) => res.json({ local: true }));
  value.put('/api/v1/users/me/settings', (_req, res) => res.end());
  value.put('/api/v1/users/me/settings/profile', (_req, res) => res.end());
  value.get('/protected', authenticationMiddleware, (req, res) =>
    res.json({ user: (req as any).user })
  );
  return value;
}
describe('SCORETech OIDC bridge', () => {
  it('uses PKCE, nonce, browser binding and atomic one-use state; never accepts identity roles as SPHERE roles', async () => {
    const flow = await begin();
    await expect(service.complete(flow.state, '0'.repeat(64), 'code')).rejects.toThrow('binding');
    expect(cache.has('sso:scoretech:flow:' + flow.state)).toBe(true);
    const result = await service.complete(flow.state, flow.binding, 'code');
    expect(provider.findOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'scoretech',
        providerId: scoretechIdentityId(issuer, 'central-subject'),
      })
    );
    expect(provider.findOrCreateUser.mock.calls[0][0]).not.toHaveProperty('role');
    expect((await service.session(result.sessionId!)).token).not.toBe('unused');
    await expect(service.complete(flow.state, flow.binding, 'code')).rejects.toThrow();
  });
  it.each(['nonce', 'audience'])('rejects an invalid %s before resolving accounts', async type => {
    const flow = await begin();
    badNonce = type === 'nonce';
    wrongAudience = type === 'audience';
    await expect(service.complete(flow.state, flow.binding, 'code')).rejects.toThrow();
    expect(provider.findOrCreateUser).not.toHaveBeenCalled();
  });
  it('links an explicitly authenticated existing SPHERE account without provisioning another', async () => {
    process.env.AUTH_PROVIDER = 'local';
    const flow = await service.begin('/', false, user.id);
    const url = new URL(flow.url);
    nonce = url.searchParams.get('nonce')!;
    challenge = url.searchParams.get('code_challenge')!;
    expect(url.searchParams.get('prompt')).toBe('login');
    await service.complete(flow.state, flow.binding, 'code');
    expect(provider.linkIdentity).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ provider: 'scoretech' })
    );
    expect(provider.findOrCreateUser).not.toHaveBeenCalled();
  });
  it('coalesces refresh and preserves active sessions on transient provider outages', async () => {
    const id = await connected();
    const key = 'sso:scoretech:session:' + id;
    cache.get(key).accessExpiresAt = 0;
    down = true;
    await expect(service.session(id)).rejects.toThrow('Identity unavailable');
    expect(cache.has(key)).toBe(true);
    down = false;
    grants = 0;
    await Promise.all([service.session(id), service.session(id), service.session(id)]);
    expect(grants).toBe(1);
  });
  it('removes a revoked native session and cannot resurrect a concurrently logged-out bridge', async () => {
    const id = await connected();
    const key = 'sso:scoretech:session:' + id;
    cache.get(key).accessExpiresAt = 0;
    revoked = true;
    await expect(service.session(id)).rejects.toThrow('UNAUTHORIZED');
    expect(cache.has(key)).toBe(false);
    revoked = false;
    const another = await connected();
    cache.get('sso:scoretech:session:' + another).accessExpiresAt = 0;
    replace.mockImplementationOnce(async () => false);
    await expect(service.session(another)).rejects.toThrow('UNAUTHORIZED');
  });
  it('requires the bridge in identity mode and rejects it when local mode is restored', async () => {
    const value = app();
    await request(value)
      .get('/protected')
      .set('Authorization', 'Bearer ' + generateJwtToken(user))
      .expect(401);
    const id = await connected();
    const token = (await service.session(id)).token;
    await request(value)
      .get('/protected')
      .set('Authorization', 'Bearer ' + token)
      .expect(200);
    process.env.AUTH_PROVIDER = 'local';
    await request(value)
      .get('/protected')
      .set('Authorization', 'Bearer ' + token)
      .expect(401);
    await request(value)
      .get('/protected')
      .set('Authorization', 'Bearer ' + generateJwtToken(user))
      .expect(200);
  });
  it('does not expose configuration secrets and enforces origins on cookie operations', async () => {
    const value = app();
    const config = await request(value).get('/config').expect(200);
    expect(JSON.stringify(config.body)).not.toContain('fixture-secret');
    await request(value).post('/session').set('Origin', 'https://evil.test').expect(403);
    await request(value).post('/logout').set('Origin', 'https://evil.test').expect(403);
    await request(value).post('/session').set('Origin', 'http://localhost:5173').expect(401);
  });
  it('keeps local profiles editable and blocks local credentials and login email changes in Identity mode', async () => {
    const value = app();
    await request(value).post('/api/v1/users/login').expect(409);
    await request(value).post('/API/v1/USERS/login/').expect(409);
    await request(value).put('/API/v1/USERS/ME/settings/').send({ email: 'new@example.test' }).expect(409);
    await request(value).put('/api/v1/users/me/settings').send({ firstName: 'New name' }).expect(200);
    await request(value).put('/api/v1/users/me/settings/profile').expect(200);
    process.env.AUTH_PROVIDER = 'local';
    await request(value).post('/api/v1/users/login').expect(200);
    await request(value).put('/api/v1/users/me/settings/profile').expect(200);
  });
  it('fails closed for invalid configuration and strips external return destinations', () => {
    expect(safeReturnTo('//evil.test')).toBe('/');
    expect(safeReturnTo('/\\evil.test')).toBe('/');
    expect(safeReturnTo('https://evil.test')).toBe('/');
    expect(authenticationConfig().provider).toBe('scoretech');
    process.env.AUTH_PROVIDER = 'typo';
    expect(validateAuthenticationConfig).toThrow();
    process.env.AUTH_PROVIDER = 'scoretech';
    process.env.SCORETECH_IDENTITY_CLIENT_SECRET = '';
    expect(validateAuthenticationConfig).toThrow();
  });
});
