import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import container from '../config/container';
import CacheService from './CacheService';
import UserRepository from '../repositories/mongoose/UserRepository';
import AuthProviderService from './AuthProviderService';
import { generateJwtToken } from '../utils/users/helpers';
import { identityMode, safeReturnTo, scoretechConfig } from './scoretech/config';

const random = () => randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const scoretechIdentityId = (issuer: string, subject: string) =>
  hash(JSON.stringify([issuer.replace(/\/$/, ''), subject]));
interface Flow {
  nonce: string;
  verifier: string;
  binding: string;
  returnTo: string;
  mode: boolean;
  linkUserId?: string;
}
interface Session {
  userId: string;
  subject: string;
  issuer: string;
  clientId: string;
  accessExpiresAt: number;
  refreshToken: string;
  idToken: string;
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  refresh_expires_in?: number;
}
interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}
export default class ScoretechIdentityService {
  private cache: CacheService;
  private users: UserRepository;
  private providers: AuthProviderService;
  private metadata?: Promise<Discovery>;
  private keys?: ReturnType<typeof createRemoteJWKSet>;
  private pending = new Map<string, Promise<Session>>();
  constructor() {
    this.cache = container.resolve('cacheService');
    this.users = container.resolve('userRepository');
    this.providers = container.resolve('authProviderService');
  }
  private transport(url: string) {
    const c = scoretechConfig();
    if (!url.startsWith(c.issuer + '/'))
      throw Error('Identity unavailable: unexpected provider endpoint');
    return c.transport ? c.transport + url.slice(c.issuer.length) : url;
  }
  private async discovery(): Promise<Discovery> {
    if (!this.metadata)
      this.metadata = (async () => {
        const c = scoretechConfig();
        const response = await fetch(
          this.transport(c.issuer + '/.well-known/openid-configuration'),
          { redirect: 'error', signal: AbortSignal.timeout(10000) }
        );
        if (!response.ok) throw Error('Identity unavailable');
        const value = (await response.json()) as Discovery;
        if (value.issuer !== c.issuer) throw Error('Identity unavailable: issuer mismatch');
        for (const url of [
          value.authorization_endpoint,
          value.token_endpoint,
          value.jwks_uri,
          ...(value.end_session_endpoint ? [value.end_session_endpoint] : []),
        ])
          this.transport(url);
        this.keys = createRemoteJWKSet(new URL(this.transport(value.jwks_uri)), {
          timeoutDuration: 10000,
        });
        return value;
      })().catch(error => {
        this.metadata = undefined;
        throw error;
      });
    return this.metadata;
  }
  async begin(returnTo: unknown, register: boolean, linkUserId?: string) {
    const c = scoretechConfig();
    const metadata = await this.discovery();
    const state = random();
    const binding = random();
    const verifier = randomBytes(32).toString('base64url');
    const nonce = random();
    await this.cache.set(
      'sso:scoretech:flow:' + state,
      {
        nonce,
        verifier,
        binding: hash(binding),
        returnTo: safeReturnTo(returnTo),
        mode: identityMode(),
        ...(linkUserId ? { linkUserId } : {}),
      } satisfies Flow,
      600
    );
    const url = new URL(
      register
        ? metadata.authorization_endpoint.replace(/\/auth$/, '/registrations')
        : metadata.authorization_endpoint
    );
    url.search = new URLSearchParams({
      client_id: c.clientId,
      response_type: 'code',
      scope: 'openid profile email',
      redirect_uri: c.callback,
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ui_locales: 'en',
      ...(linkUserId ? { prompt: 'login', max_age: '0' } : {}),
    }).toString();
    return { url: url.href, state, binding };
  }
  private async grant(parameters: Record<string, string>): Promise<Tokens> {
    const c = scoretechConfig();
    const metadata = await this.discovery();
    let response: Response;
    try {
      response = await fetch(this.transport(metadata.token_endpoint), {
        method: 'POST',
        body: new URLSearchParams({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          ...parameters,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw Error('Identity unavailable: token exchange failed');
    }
    const value = (await response.json().catch(() => ({}))) as Partial<Tokens> & { error?: string };
    if (!response.ok) {
      if (value.error === 'invalid_grant')
        throw Error('UNAUTHORIZED: Your identity session has ended');
      throw Error('Identity unavailable: provider rejected the token exchange');
    }
    if (
      typeof value.access_token !== 'string' ||
      typeof value.refresh_token !== 'string' ||
      typeof value.expires_in !== 'number' ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0
    )
      throw Error('Identity unavailable: incomplete token response');
    return value as Tokens;
  }
  private async verify(tokens: Tokens, nonce?: string, subject?: string): Promise<JWTPayload> {
    await this.discovery();
    const c = scoretechConfig();
    const access = await jwtVerify(tokens.access_token, this.keys!, {
      issuer: c.issuer,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    if (access.payload.azp !== c.clientId || (subject && access.payload.sub !== subject))
      throw Error('UNAUTHORIZED: Invalid identity token');
    let profile = access.payload;
    if (tokens.id_token) {
      profile = (
        await jwtVerify(tokens.id_token, this.keys!, {
          issuer: c.issuer,
          audience: c.clientId,
          algorithms: ['RS256'],
          requiredClaims: ['sub', 'exp', 'iat'],
        })
      ).payload;
      if (
        profile.sub !== access.payload.sub ||
        (profile.azp !== undefined && profile.azp !== c.clientId)
      )
        throw Error('UNAUTHORIZED: Identity subject mismatch');
    } else if (nonce) throw Error('UNAUTHORIZED: Missing identity proof');
    if (nonce && profile.nonce !== nonce) throw Error('UNAUTHORIZED: Identity nonce mismatch');
    return profile;
  }
  private ttl(tokens: Tokens) {
    return Math.max(1, Math.min(30 * 86400, tokens.refresh_expires_in || 43200));
  }
  async complete(
    state: unknown,
    binding: string | undefined,
    code: unknown,
    providerError?: unknown
  ) {
    if (
      typeof state !== 'string' ||
      !/^[a-f0-9]{64}$/.test(state) ||
      !binding ||
      !/^[a-f0-9]{64}$/.test(binding)
    )
      throw Error('UNAUTHORIZED: Invalid identity state');
    const key = 'sso:scoretech:flow:' + state;
    const pending: Flow | null = await this.cache.get(key);
    if (!pending || !timingSafeEqual(Buffer.from(hash(binding)), Buffer.from(pending.binding)))
      throw Error('UNAUTHORIZED: Invalid identity browser binding');
    const flow: Flow | null = await this.cache.take(key);
    if (!flow || flow.mode !== identityMode())
      throw Error('UNAUTHORIZED: Identity configuration changed');
    if (providerError || typeof code !== 'string' || code.length > 4096)
      throw Error('UNAUTHORIZED: Identity sign-in was not completed');
    const c = scoretechConfig();
    const tokens = await this.grant({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.callback,
      code_verifier: flow.verifier,
    });
    const claims = await this.verify(tokens, flow.nonce);
    if (typeof claims.email !== 'string' || typeof claims.sub !== 'string')
      throw Error('UNAUTHORIZED: Identity profile is incomplete');
    const profile = {
      provider: 'scoretech' as const,
      providerId: scoretechIdentityId(c.issuer, claims.sub),
      email: claims.email.toLowerCase(),
      emailVerified: claims.email_verified === true,
      firstName:
        typeof claims.given_name === 'string' && claims.given_name.trim()
          ? claims.given_name.slice(0, 100)
          : claims.email.split('@')[0],
      lastName:
        typeof claims.family_name === 'string' && claims.family_name.trim()
          ? claims.family_name.slice(0, 100)
          : 'Member',
      suggestedUsername: claims.email.split('@')[0],
    };
    if (flow.linkUserId) {
      await this.providers.linkIdentity(flow.linkUserId, profile);
      return { returnTo: '/me/settings?identity_linked=scoretech' };
    }
    const { user } = await this.providers.findOrCreateUser(profile);
    const sessionId = random();
    const session: Session = {
      userId: user.id,
      subject: claims.sub,
      issuer: c.issuer,
      clientId: c.clientId,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token!,
      accessExpiresAt: Date.now() + Math.min(tokens.expires_in, 86400) * 1000,
    };
    await this.cache.replacePrivate(
      'sso:scoretech:session:' + sessionId,
      session,
      this.ttl(tokens)
    );
    return { sessionId, returnTo: flow.returnTo };
  }
  private async active(id: string): Promise<Session> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('UNAUTHORIZED: Invalid identity session');
    const session: Session | null = await this.cache.get('sso:scoretech:session:' + id);
    if (
      !session ||
      session.issuer !== scoretechConfig().issuer ||
      session.clientId !== scoretechConfig().clientId
    )
      throw Error('UNAUTHORIZED: Your identity session has ended');
    if (session.accessExpiresAt > Date.now() + 30000) return session;
    const running = this.pending.get(id);
    if (running) return running;
    const renewal = (async () => {
      const lock = 'sso:scoretech:refresh:' + id;
      if (!(await this.cache.setIfAbsent(lock, true, 30)))
        throw Error('Identity unavailable: session refresh is in progress');
      try {
        const latest: Session | null = await this.cache.get('sso:scoretech:session:' + id);
        if (!latest) throw Error('UNAUTHORIZED: Your identity session has ended');
        if (latest.accessExpiresAt > Date.now() + 30000) return latest;
        const tokens = await this.grant({
          grant_type: 'refresh_token',
          refresh_token: latest.refreshToken,
        });
        await this.verify(tokens, undefined, latest.subject);
        const next = {
          ...latest,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token || latest.idToken,
          accessExpiresAt: Date.now() + Math.min(tokens.expires_in, 86400) * 1000,
        };
        if (
          !(await this.cache.replacePrivate(
            'sso:scoretech:session:' + id,
            next,
            this.ttl(tokens),
            true
          ))
        )
          throw Error('UNAUTHORIZED: Your identity session has ended');
        return next;
      } catch (error) {
        if (String(error).includes('UNAUTHORIZED:'))
          await this.cache.del('sso:scoretech:session:' + id);
        throw error;
      } finally {
        await this.cache.del(lock);
      }
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, renewal);
    return renewal;
  }
  async authenticate(id: string, userId: string) {
    if (!identityMode()) throw Error('UNAUTHORIZED: Identity mode is disabled');
    const session = await this.active(id);
    if (session.userId !== userId) throw Error('UNAUTHORIZED: Identity account mismatch');
  }
  async session(id: string) {
    const session = await this.active(id);
    const user = await this.users.findById(session.userId);
    if (!user) throw Error('UNAUTHORIZED: SPHERE account no longer exists');
    const token = generateJwtToken(user, id);
    return { token, tokenExpiration: new Date(Date.now() + 300000).toISOString() };
  }
  async clearLocal(id: string) {
    if (/^[a-f0-9]{64}$/.test(id)) await this.cache.del('sso:scoretech:session:' + id);
  }
  async logout(id: string) {
    const session: Session | null = /^[a-f0-9]{64}$/.test(id)
      ? await this.cache.take('sso:scoretech:session:' + id)
      : null;
    if (!session) return;
    const c = scoretechConfig();
    const metadata = await this.discovery();
    if (metadata.end_session_endpoint)
      await fetch(this.transport(metadata.end_session_endpoint), {
        method: 'POST',
        body: new URLSearchParams({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          refresh_token: session.refreshToken,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      }).catch(() => undefined);
  }
}
