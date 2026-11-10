import { identityModePolicy } from '../controllers/ScoretechIdentityController';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { authenticationMiddleware } from './AuthenticationMiddleware';
import { authorizationMiddleware } from './AuthorizationMiddleware';
import { apiRateLimiter, authRateLimiter } from './RateLimitMiddleware';
import { protectedStatic } from './StaticFilesMiddleware';

const loadGlobalMiddlewares = (app: express.Application) => {
  // Requests arrive through NGINX, so the client address is the one it forwards.
  // Only proxies on the local or private network are trusted to set it.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  // Same limit as the body parser below: whichever parses first wins, and the
  // 100kb default would turn away files sent to ORBIT long before 2mb.
  app.use(express.json({ limit: '2mb' }));
  // Expose pricing revisions alongside the OAuth challenge and MCP session headers.
  app.use((request, response, next) => {
    if (request.path.startsWith((process.env.BASE_URL_PATH || '') + '/api/v1/auth/identity/')) {
      return cors({ origin: new URL(process.env.FRONTEND_URL || 'http://localhost:5173').origin, credentials: true })(request, response, next);
    }
    return cors({ exposedHeaders: ['ETag', 'WWW-Authenticate', 'Mcp-Session-Id'] })(request, response, next);
  });
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    })
  );
  // Pricing YAML of private versions is only served to authorized callers.
  app.use(protectedStatic('public'));
  app.use(bodyParser.json({ limit: '2mb' }));
  app.use(bodyParser.urlencoded({ limit: '2mb', extended: true }));
  app.use(authenticationMiddleware);
  // After authentication, so that a signed-in client is limited as itself
  // rather than as its network address.
  app.use(authRateLimiter);
  app.use(apiRateLimiter);
  app.use(identityModePolicy);
  app.use(authorizationMiddleware);
};

export default loadGlobalMiddlewares;
