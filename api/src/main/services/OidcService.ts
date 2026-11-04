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

/** A deliberately separate identity surface: MCP tokens, grants and DCR stay in OAuthService. */
export default class OidcService {
  private get cache(): CacheService { return container.resolve('cacheService'); }
  available() {
    return Boolean(process.env.OIDC_SPACE_CLIENT_ID && process.env.OIDC_SPACE_CLIENT_SECRET &&
      process.env.OIDC_SPACE_REDIRECT_URI && process.env.OIDC_SIGNING_PRIVATE_KEY);
  }
  private config() {
    if (!this.available()) throw new OidcError(503, 'temporarily_unavailable', 'SPHERE sign-in is not configured');
    const redirectUri = process.env.OIDC_SPACE_REDIRECT_URI!;
    if (!validOAuthRedirect(redirectUri)) throw new Error('Invalid OIDC_SPACE_REDIRECT_URI');
    return { clientId: process.env.OIDC_SPACE_CLIENT_ID!, clientSecret: process.env.OIDC_SPACE_CLIENT_SECRET!, redirectUri };
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
    this.config();
    return { issuer: oauthIssuer(), authorization_endpoint: this.endpoint('authorize'), token_endpoint: this.endpoint('token'),
      userinfo_endpoint: this.endpoint('userinfo'), jwks_uri: this.endpoint('jwks'),
      response_types_supported: ['code'], grant_types_supported: ['authorization_code'], subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
      scopes_supported: ['openid', 'profile', 'email'], code_challenge_methods_supported: ['S256'],
      claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'preferred_username', 'name', 'email', 'email_verified'] };
  }
  jwks() { this.config(); return { keys: [this.signingKey().jwk] }; }
  async authorize(params: Record<string, unknown>) {
    const config = this.config();
    if (params.client_id !== config.clientId || params.redirect_uri !== config.redirectUri) invalid('Unknown client or redirect URI');
    if (params.response_type !== 'code' || params.code_challenge_method !== 'S256' ||
      typeof params.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) invalid('Use code and S256 PKCE');
    if (typeof params.state !== 'string' || params.state.length < 16 || params.state.length > 512 ||
      typeof params.nonce !== 'string' || params.nonce.length < 16 || params.nonce.length > 512) invalid('state and nonce are required');
    const scopes = typeof params.scope === 'string' ? params.scope.split(' ') : [];
    if (!scopes.includes('openid') || scopes.some(scope => !['openid', 'profile', 'email'].includes(scope))) invalid('Unsupported identity scopes');
    const id = secret();
    await this.cache.set(prefix + 'request:' + id, { clientId: config.clientId, redirectUri: config.redirectUri, state: params.state,
      nonce: params.nonce, challenge: params.code_challenge, scopes }, 600);
    return oauthIssuer() + '/oidc/consent?request=' + id;
  }
  private async pending(id: string, userId: string): Promise<Pending> {
    if (!/^[a-f0-9]{64}$/.test(id)) invalid('Invalid consent request');
    const pending = await this.cache.get(prefix + 'request:' + id);
    if (!pending) invalid('Consent request expired. Start again from SPACE.');
    await this.cache.setIfAbsent(prefix + 'owner:' + id, userId, 600);
    if (await this.cache.get(prefix + 'owner:' + id) !== userId) invalid('Consent request belongs to another session');
    return pending;
  }
  async consentRequest(id: string, userId: string) {
    const pending = await this.pending(id, userId);
    return { clientName: 'SPACE', redirectDomain: new URL(pending.redirectUri).host, scopes: pending.scopes };
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
      ...(scopes.includes('profile') ? { preferred_username: user.username, name: [user.firstName, user.lastName].filter(Boolean).join(' ') } : {}),
      ...(scopes.includes('email') ? { email: user.email, email_verified: user.emailVerified === true } : {}) };
  }
  async exchange(body: Record<string, unknown>) {
    const config = this.config();
    const supplied = typeof body.client_secret === 'string' ? body.client_secret : '';
    if (body.client_id !== config.clientId || !timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(config.clientSecret)))) {
      throw new OidcError(401, 'invalid_client', 'Invalid client credentials');
    }
    if (body.grant_type !== 'authorization_code') throw new OidcError(400, 'unsupported_grant_type', 'Only authorization_code is supported');
    if (typeof body.code !== 'string' || typeof body.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) invalid('Invalid code or verifier');
    const key = prefix + 'code:' + hash(body.code as string);
    const code: Code | null = await this.cache.get(key);
    if (!code || code.clientId !== config.clientId || body.redirect_uri !== code.redirectUri || code.redirectUri !== config.redirectUri ||
      createHash('sha256').update(body.code_verifier as string).digest('base64url') !== code.challenge) {
      throw new OidcError(400, 'invalid_grant', 'Invalid code, callback or PKCE verifier');
    }
    if (!await this.cache.take(key)) throw new OidcError(400, 'invalid_grant', 'Code already used');
    const claims = await this.claims(code.userId, code.scopes);
    const signing = this.signingKey();
    const idToken = jwt.sign({ ...claims, nonce: code.nonce }, signing.privateKey, {
      algorithm: 'RS256', keyid: signing.jwk.kid, issuer: oauthIssuer(), audience: config.clientId, expiresIn: 300,
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
