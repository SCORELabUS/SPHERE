import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { authenticationMiddleware } from './AuthenticationMiddleware';
import { authorizationMiddleware } from './AuthorizationMiddleware';
import { apiRateLimiter, authRateLimiter } from './RateLimitMiddleware';

const loadGlobalMiddlewares = (app: express.Application) => {
  // Requests arrive through NGINX, so the client address is the one it forwards.
  // Only proxies on the local or private network are trusted to set it.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  // Same limit as the body parser below: whichever parses first wins, and the
  // 100kb default would turn away files sent to ORBIT long before 2mb.
  app.use(express.json({ limit: '2mb' }));
  // ETag is exposed so that browser clients on other origins can send it back
  // in If-Match when they edit a pricing.
  app.use(cors({ exposedHeaders: ['ETag'] }));
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    })
  );
  app.use(express.static('public'));
  app.use(bodyParser.json({ limit: '2mb' }));
  app.use(bodyParser.urlencoded({ limit: '2mb', extended: true }));
  app.use(authenticationMiddleware);
  // After authentication, so that a signed-in client is limited as itself
  // rather than as its network address.
  app.use(authRateLimiter);
  app.use(apiRateLimiter);
  app.use(authorizationMiddleware);
};

export default loadGlobalMiddlewares;
