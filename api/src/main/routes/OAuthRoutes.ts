import type { Application } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import container from '../config/container';
import OAuthController from '../controllers/OAuthController';
import OAuthService, { oauthIssuer, oauthResource } from '../services/OAuthService';

export default function loadOAuthRoutes(app: Application) {
  const provider: OAuthService = container.resolve('oauthService');
  const base = (process.env.BASE_URL_PATH ?? '') + '/api/v1/oauth';
  const endpoint = (name: string) => oauthIssuer() + base + '/' + name;
  // Individual SDK handlers support our /api/v1/oauth prefix; mcpAuthRouter
  // resolves absolute /authorize paths and would discard that prefix.
  app.use(base + '/authorize', authorizationHandler({ provider }));
  app.use(base + '/token', rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false,
    message: { error: 'temporarily_unavailable', error_description: 'Too many token requests. Try again later.' } }), (req, res, next) => {
    if (req.body?.grant_type === 'authorization_code' &&
        (typeof req.body.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(req.body.code_verifier))) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid PKCE verifier' });
    }
    next();
  }, tokenHandler({ provider, rateLimit: false }));
  app.use(base + '/register', clientRegistrationHandler({ clientsStore: provider.clientsStore,
    rateLimit: { windowMs: 3600000, limit: 20 } }));
  app.use(base + '/revoke', revocationHandler({ provider }));
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    issuer: oauthIssuer(), authorization_endpoint: endpoint('authorize'), token_endpoint: endpoint('token'),
    registration_endpoint: endpoint('register'), revocation_endpoint: endpoint('revoke'),
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'], scopes_supported: ['orbit'],
  }));
  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource' + new URL(oauthResource()).pathname],
    (_req, res) => res.json({ resource: oauthResource(), authorization_servers: [oauthIssuer()], scopes_supported: ['orbit'], bearer_methods_supported: ['header'] }));
  const controller = new OAuthController();
  app.route(base + '/requests/:requestId').get(controller.handle).post(controller.handle);
  app.get(base + '/grants', controller.handle);
  app.delete(base + '/grants/:grantId', controller.handle);
}
