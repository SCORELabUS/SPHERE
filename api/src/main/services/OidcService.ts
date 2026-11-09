import { createHash, createPrivateKey, createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import container from '../config/container';
import CacheService from './CacheService';
import { oauthIssuer, validOAuthRedirect } from './OAuthService';

const secret = () => randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const prefix = 'oidc:';
export class OidcError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = (message: string): never => { throw new OidcError(400, 'invalid_request', message); };
interface Pending {
  clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; scopes: string[];
}
interface Code extends Pending { userId: string }
interface Client { key: string; name: string; clientId: string; clientSecret: string; redirectUri: string }

/**
 * Applications that may sign their users in with SPHERE. The deployment registers each one
 * with OIDC_<key>_CLIENT_ID, OIDC_<key>_CLIENT_SECRET and OIDC_<key>_REDIRECT_URI; one left
 * without them is simply not offered. `name` is what the consent page shows. A new
 * application is one entry here.
 */
const REGISTERED_CLIENTS = [
  { key: 'SPACE', name: 'SPACE' },
  { key: 'ICAN', name: 'ICAN' },
] as const;

/** A deliberately separate identity surface: MCP tokens, grants and DCR stay in OAuthService. */
export default class OidcService {
  private get cache(): CacheService { return container.resolve('cacheService'); }
  private configuredClients(): Client[] {
    return REGISTERED_CLIENTS.flatMap(({ key, name }) => {
      const env = (field: string) => process.env[`OIDC_${key}_${field}`] ?? '';
      const client = { key, name, clientId: env('CLIENT_ID'), clientSecret: env('CLIENT_SECRET'), redirectUri: env('REDIRECT_URI') };
      return client.clientId && client.clientSecret && client.redirectUri ? [client] : [];
    });
  }
  available() {
    return Boolean(process.env.OIDC_SIGNING_PRIVATE_KEY) && this.configuredClients().length > 0;
  }
  private clients(): Client[] {
    if (!this.available()) throw new OidcError(503, 'temporarily_unavailable', 'SPHERE sign-in is not configured');
    const clients = this.configuredClients();
    for (const client of clients) {
      if (!validOAuthRedirect(client.redirectUri)) throw new Error(`Invalid OIDC_${client.key}_REDIRECT_URI`);
    }
    if (new Set(clients.map(client => client.clientId)).size !== clients.length) {
      throw new Error('Each OIDC client needs its own OIDC_<key>_CLIENT_ID');
    }
    return clients;
  }
  private client(clientId: unknown): Client | undefined {
    return this.clients().find(client => client.clientId === clientId);
  }
  private signingKey() {
    const privateKey = createPrivateKey(process.env.OIDC_SIGNING_PRIVATE_KEY!.replace(/\\n/g, '\n'));
    if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error('OIDC requires an RSA signing key of at least 2048 bits');
    }
    const publicKey = createPublicKey(privateKey);
    const kid = hash(publicKey.export({ type: 'spki', format: 'pem' }).toString()).slice(0, 24);
    return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
  }
  endpoint(name: string) { return oauthIssuer() + (process.env.BASE_URL_PATH ?? '') + '/api/v1/oidc/' + name; }
  discovery() {
    this.clients();
    return { issuer: oauthIssuer(), authorization_endpoint: this.endpoint('authorize'), token_endpoint: this.endpoint('token'),
      userinfo_endpoint: this.endpoint('userinfo'), jwks_uri: this.endpoint('jwks'),
      response_types_supported: ['code'], grant_types_supported: ['authorization_code'], subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
      scopes_supported: ['openid', 'profile', 'email'], code_challenge_methods_supported: ['S256'],
      claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'preferred_username', 'name', 'given_name', 'family_name',
        'email', 'email_verified'] };
  }
  jwks() { this.clients(); return { keys: [this.signingKey().jwk] }; }
  async authorize(params: Record<string, unknown>) {
    const client = this.client(params.client_id);
    if (!client || params.redirect_uri !== client.redirectUri) invalid('Unknown client or redirect URI');
    if (params.response_type !== 'code' || params.code_challenge_method !== 'S256' ||
      typeof params.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) invalid('Use code and S256 PKCE');
    if (typeof params.state !== 'string' || params.state.length < 16 || params.state.length > 512 ||
      typeof params.nonce !== 'string' || params.nonce.length < 16 || params.nonce.length > 512) invalid('state and nonce are required');
    const scopes = typeof params.scope === 'string' ? params.scope.split(' ') : [];
    if (!scopes.includes('openid') || scopes.some(scope => !['openid', 'profile', 'email'].includes(scope))) invalid('Unsupported identity scopes');
    const id = secret();
    await this.cache.set(prefix + 'request:' + id, { clientId: client!.clientId, redirectUri: client!.redirectUri, state: params.state,
      nonce: params.nonce, challenge: params.code_challenge, scopes }, 600);
    return oauthIssuer() + '/oidc/consent?request=' + id;
  }
  private async pending(id: string, userId: string): Promise<Pending> {
    if (!/^[a-f0-9]{64}$/.test(id)) invalid('Invalid consent request');
    const pending = await this.cache.get(prefix + 'request:' + id);
    if (!pending) invalid('Consent request expired. Start again from the application you were signing in to.');
    await this.cache.setIfAbsent(prefix + 'owner:' + id, userId, 600);
    if (await this.cache.get(prefix + 'owner:' + id) !== userId) invalid('Consent request belongs to another session');
    return pending;
  }
  async consentRequest(id: string, userId: string) {
    const pending = await this.pending(id, userId);
    const client = this.client(pending.clientId);
    if (!client) invalid('This application can no longer sign in with SPHERE');
    return { clientName: client!.name, redirectDomain: new URL(pending.redirectUri).host, scopes: pending.scopes };
  }
  async decide(id: string, userId: string, approve: unknown) {
    const pending = await this.pending(id, userId);
    if (typeof approve !== 'boolean') invalid('approve must be boolean');
    if (!await this.cache.take(prefix + 'request:' + id)) invalid('Consent already used');
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set('state', pending.state);
    if (!approve) redirect.searchParams.set('error', 'access_denied');
    else {
      const code = secret();
      await this.cache.set(prefix + 'code:' + hash(code), { ...pending, userId }, 300);
      redirect.searchParams.set('code', code);
    }
    return { redirectUrl: redirect.href };
  }
  private async claims(userId: string, scopes: string[]) {
    const user = await container.resolve('userRepository').findById(userId);
    if (!user) throw new OidcError(400, 'invalid_grant', 'Account no longer exists');
    return { sub: userId,
      ...(scopes.includes('profile') ? { preferred_username: user.username, name: [user.firstName, user.lastName].filter(Boolean).join(' '),
        ...(user.firstName ? { given_name: user.firstName } : {}), ...(user.lastName ? { family_name: user.lastName } : {}) } : {}),
      ...(scopes.includes('email') ? { email: user.email, email_verified: user.emailVerified === true } : {}) };
  }
  async exchange(body: Record<string, unknown>) {
    const client = this.client(body.client_id);
    const supplied = typeof body.client_secret === 'string' ? body.client_secret : '';
    if (!client || !timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(client.clientSecret)))) {
      throw new OidcError(401, 'invalid_client', 'Invalid client credentials');
    }
    if (body.grant_type !== 'authorization_code') throw new OidcError(400, 'unsupported_grant_type', 'Only authorization_code is supported');
    if (typeof body.code !== 'string' || typeof body.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) invalid('Invalid code or verifier');
    const key = prefix + 'code:' + hash(body.code as string);
    const code: Code | null = await this.cache.get(key);
    // A code only works for the client it was issued to, at the callback that client registered.
    if (!code || code.clientId !== client.clientId || body.redirect_uri !== code.redirectUri || code.redirectUri !== client.redirectUri ||
      createHash('sha256').update(body.code_verifier as string).digest('base64url') !== code.challenge) {
      throw new OidcError(400, 'invalid_grant', 'Invalid code, callback or PKCE verifier');
    }
    if (!await this.cache.take(key)) throw new OidcError(400, 'invalid_grant', 'Code already used');
    const claims = await this.claims(code.userId, code.scopes);
    const signing = this.signingKey();
    const idToken = jwt.sign({ ...claims, nonce: code.nonce }, signing.privateKey, {
      algorithm: 'RS256', keyid: signing.jwk.kid, issuer: oauthIssuer(), audience: client.clientId, expiresIn: 300,
    });
    const accessToken = 'sph_oid_' + secret();
    await this.cache.set(prefix + 'access:' + hash(accessToken), { userId: code.userId, scopes: code.scopes }, 300);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 300, scope: code.scopes.join(' '), id_token: idToken };
  }
  async userinfo(value: string) {
    if (!value.startsWith('sph_oid_')) throw new OidcError(401, 'invalid_token', 'Identity token required');
    const access = await this.cache.get(prefix + 'access:' + hash(value));
    if (!access) throw new OidcError(401, 'invalid_token', 'Identity token expired');
    return this.claims(access.userId, access.scopes);
  }
}
