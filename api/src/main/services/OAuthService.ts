import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidRequestError, InvalidTokenError, InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import container from '../config/container';
import OAuthRepository from '../repositories/mongoose/OAuthRepository';
import CacheService from './CacheService';
import type { ApiKey } from '../types/models/User';

/** Prefix of OAuthService's cache entries; the public /cache endpoint refuses it (CacheController). */
export const OAUTH_CACHE_PREFIX = 'oauth:';
export const hashOAuthToken = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = (prefix: string) => prefix + randomBytes(32).toString('hex');
export const oauthIssuer = () => {
  const url = new URL(process.env.OAUTH_ISSUER_URL || process.env.FRONTEND_URL || 'http://localhost:5173');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('OAuth issuer must be an HTTPS origin (HTTP loopback is allowed for local development)');
  }
  return url.origin;
};
export const oauthResource = () => oauthIssuer() + (process.env.BASE_URL_PATH ?? '') + '/api/v1/orbit/mcp';
export const oauthChallenge = () => `Bearer resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource${new URL(oauthResource()).pathname}"`;

interface Pending {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  state?: string;
}
/** An approved request: the connection is only created when the client exchanges the code. */
interface Code extends Pending {
  userId: string;
  scopes: ApiKey['scopes'];
}

export function validOAuthRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.hash && !url.username && !url.password && !value.includes('*') &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

export default class OAuthService implements OAuthServerProvider {
  private get repo(): OAuthRepository { return container.resolve('oauthRepository'); }
  private get cache(): CacheService { return container.resolve('cacheService'); }

  clientsStore = {
    getClient: async (clientId: string): Promise<OAuthClientInformationFull | undefined> => {
      const client = await this.repo.findClient(clientId);
      return client?.metadata as OAuthClientInformationFull | undefined;
    },
    registerClient: async (client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> => {
      if (!client.redirect_uris.length || client.redirect_uris.length > 10 || !client.redirect_uris.every(validOAuthRedirect) ||
          (client.client_name?.length ?? 0) > 200 ||
          client.grant_types?.some(type => !['authorization_code', 'refresh_token'].includes(type)) ||
          client.response_types?.some(type => type !== 'code') ||
          !['none', 'client_secret_post'].includes(client.token_endpoint_auth_method ?? 'client_secret_post')) {
        throw new InvalidClientMetadataError('Use HTTPS or HTTP loopback redirects, without fragments or wildcards');
      }
      const metadata = { ...client, client_id: randomUUID(), client_name: client.client_name || 'MCP application' };
      await this.repo.createClient(metadata);
      return metadata;
    },
  };

  private resource(resource?: URL) {
    if (resource?.href !== oauthResource()) throw new InvalidRequestError('resource must be the exact SPHERE MCP URL');
    return resource.href;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const resource = this.resource(params.resource);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError('Invalid S256 challenge');
    if (params.scopes?.some(scope => scope !== 'orbit')) throw new InvalidRequestError('Unsupported scope');
    const id = secret('');
    const pending: Pending = { clientId: client.client_id, clientName: client.client_name || 'MCP application',
      redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, resource, state: params.state };
    await this.cache.set(OAUTH_CACHE_PREFIX + 'request:' + id, pending, 600);
    res.redirect(oauthIssuer() + '/oauth/consent?request=' + id);
  }

  private async pending(id: string, userId: string): Promise<Pending> {
    const pending = await this.cache.get(OAUTH_CACHE_PREFIX + 'request:' + id);
    if (!pending) throw new Error('NOT FOUND: Consent request expired');
    await this.cache.setIfAbsent(OAUTH_CACHE_PREFIX + 'owner:' + id, userId, 600);
    if (await this.cache.get(OAUTH_CACHE_PREFIX + 'owner:' + id) !== userId) throw new Error('NOT FOUND: Consent request unavailable');
    return pending;
  }

  async consentRequest(id: string, userId: string) {
    const pending = await this.pending(id, userId);
    return { clientName: pending.clientName, redirectDomain: new URL(pending.redirectUri).host };
  }

  async decide(id: string, userId: string, approve: unknown, scopes: ApiKey['scopes']) {
    const pending = await this.pending(id, userId);
    if (typeof approve !== 'boolean') throw new Error('INVALID DATA: approve must be a boolean');
    if (approve) {
      if (!Array.isArray(scopes) || !scopes.length || scopes.length > 100) throw new Error('INVALID DATA: Choose organizations and scopes');
      const seen = new Set<string>();
      for (const scope of scopes) {
        if (!scope || !/^[a-f0-9]{24}$/i.test(scope.organizationId) || !['VIEW', 'MANAGEMENT', 'ALL'].includes(scope.scope) || seen.has(scope.organizationId)) {
          throw new Error('INVALID DATA: Invalid or duplicate organization scope');
        }
        seen.add(scope.organizationId);
        const role = await container.resolve('organizationService').getUserOrgRole(userId, scope.organizationId);
        if (!role) throw new Error('PERMISSION ERROR: You do not belong to this organization');
      }
    }
    // Consume only after validation, atomically, before issuing any grant/code.
    if (!await this.cache.take(OAUTH_CACHE_PREFIX + 'request:' + id)) throw new Error('NOT FOUND: Consent request already consumed');
    const callback = new URL(pending.redirectUri);
    if (pending.state !== undefined) callback.searchParams.set('state', pending.state);
    if (!approve) { callback.searchParams.set('error', 'access_denied'); return { redirectUrl: callback.href }; }
    const code = secret('');
    const approved: Code = { ...pending, userId, scopes };
    await this.cache.set(OAUTH_CACHE_PREFIX + 'code:' + hashOAuthToken(code), approved, 300);
    callback.searchParams.set('code', code);
    return { redirectUrl: callback.href };
  }

  private async code(client: OAuthClientInformationFull, value: string): Promise<Code> {
    const code = await this.cache.get(OAUTH_CACHE_PREFIX + 'code:' + hashOAuthToken(value));
    if (!code || code.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    return code;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, value: string) {
    return (await this.code(client, value)).codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, value: string, _verifier?: string, redirectUri?: string, resource?: URL) {
    const code = await this.code(client, value);
    if (code.resource !== this.resource(resource) || redirectUri !== code.redirectUri) throw new InvalidGrantError('redirect_uri or resource mismatch');
    if (!await this.cache.take(OAUTH_CACHE_PREFIX + 'code:' + hashOAuthToken(value))) throw new InvalidGrantError('Authorization code already used');
    // Created only now, so an approval whose code is never exchanged leaves no connection behind.
    const grant = await this.repo.createGrant({ userId: code.userId, clientId: code.clientId, clientName: code.clientName,
      resource: code.resource, scopes: code.scopes, refreshHash: secret('pending_'), expiresAt: new Date(Date.now() + 30 * 86400000) });
    return this.issue(String(grant._id));
  }

  private async issue(grantId: string) {
    const access = secret('sph_oat_');
    const refresh = secret('sph_ort_');
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const grant = await this.repo.rotateGrant(grantId, hashOAuthToken(refresh), expiresAt);
    if (!grant) throw new InvalidGrantError('Connection revoked');
    await this.repo.createTokens([
      { hash: hashOAuthToken(access), grantId, kind: 'access', resource: grant.resource, expiresAt: new Date(Date.now() + 3600000) },
      { hash: hashOAuthToken(refresh), grantId, kind: 'refresh', resource: grant.resource, expiresAt },
    ]);
    return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: 'orbit' };
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, value: string, scopes?: string[], resource?: URL) {
    this.resource(resource);
    if (scopes?.some(scope => scope !== 'orbit')) throw new InvalidRequestError('Unsupported scope');
    const token = await this.repo.findToken(hashOAuthToken(value), 'refresh');
    if (!token) throw new InvalidGrantError('Invalid refresh token');
    const grant = await this.repo.findGrantForClient(token.grantId, client.client_id);
    if (!grant || grant.revoked || grant.expiresAt <= new Date()) throw new InvalidGrantError('Connection expired or revoked');
    if (token.resource !== oauthResource() || grant.resource !== oauthResource()) throw new InvalidGrantError('Refresh token audience mismatch');
    // Compare-and-swap prevents two concurrent exchanges from accepting the same token.
    const claimed = await this.repo.claimRefresh(String(grant._id), token.hash, secret('spent_'));
    if (!claimed) {
      await this.repo.revoke(String(grant._id));
      throw new InvalidGrantError('Refresh token reuse: connection revoked');
    }
    return this.issue(String(grant._id));
  }

  async authenticate(value: string) {
    const token = await this.repo.findToken(hashOAuthToken(value), 'access', oauthResource());
    const grant = token && await this.repo.findActiveGrant(token.grantId, oauthResource());
    if (!token || !grant) throw new InvalidTokenError('Invalid or expired MCP access token');
    const user = await container.resolve('userRepository').findById(grant.userId);
    if (!user) throw new InvalidTokenError('User no longer exists');
    await this.repo.touchGrant(String(grant._id));
    const credential: ApiKey = { _id: 'oauth:' + grant._id, name: grant.clientName, key: '', revoked: false,
      scopes: grant.scopes.map(s => ({ organizationId: s.organizationId!, scope: s.scope! })), expiresAt: grant.expiresAt };
    return { user, credential, clientId: grant.clientId, expiresAt: token.expiresAt };
  }

  async verifyAccessToken(value: string) {
    const auth = await this.authenticate(value);
    return { token: value, clientId: auth.clientId, scopes: ['orbit'], expiresAt: Math.floor(auth.expiresAt.getTime() / 1000), resource: new URL(oauthResource()) };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const token = await this.repo.findAnyToken(hashOAuthToken(request.token));
    if (token) await this.repo.revokeForClient(token.grantId, client.client_id);
  }

  async listGrants(userId: string) {
    const grants = await this.repo.listGrants(userId);
    const ids = [...new Set(grants.flatMap(grant => grant.scopes.map(scope => scope.organizationId!)))];
    const organizations = await Promise.all(ids.map(id => container.resolve('organizationRepository').findById(id).catch(() => null)));
    const names = new Map(ids.map((id, index) => [id, organizations[index]?.displayName || 'Deleted organization']));
    return grants.map(grant => ({ ...grant, scopes: grant.scopes.map(scope => ({ ...scope, organizationName: names.get(scope.organizationId!) })) }));
  }

  async revokeGrant(userId: string, id: string) {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error('NOT FOUND: Connection not found');
    const grant = await this.repo.revokeForUser(id, userId);
    if (!grant) throw new Error('NOT FOUND: Connection not found');
  }
}
