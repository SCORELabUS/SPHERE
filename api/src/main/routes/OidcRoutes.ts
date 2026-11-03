import type { Application } from 'express';
import { rateLimit } from 'express-rate-limit';
import OidcController from '../controllers/OidcController';

export default function loadOidcRoutes(app: Application) {
  const controller = new OidcController();
  const base = (process.env.BASE_URL_PATH ?? '') + '/api/v1/oidc';
  app.get('/.well-known/openid-configuration', controller.handle);
  app.get(base + '/jwks', controller.handle);
  app.get(base + '/authorize', rateLimit({ windowMs: 60000, limit: 30 }), controller.handle);
  app.post(base + '/token', rateLimit({ windowMs: 60000, limit: 30 }), controller.handle);
  app.get(base + '/userinfo', controller.handle);
  app.route(base + '/requests/:requestId').get(controller.handle).post(controller.handle);
}
