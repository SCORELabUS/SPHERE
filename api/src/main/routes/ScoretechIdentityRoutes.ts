import type express from 'express';
import ScoretechIdentityController from '../controllers/ScoretechIdentityController';
export default function loadScoretechIdentityRoutes(app: express.Application) {
  const controller = new ScoretechIdentityController();
  const base = (process.env.BASE_URL_PATH || '') + '/api/v1/auth';
  app.get(base + '/config', controller.config);
  app.get(base + '/identity/login', controller.login);
  app.get(base + '/identity/callback', controller.callback);
  app.post(base + '/identity/session', controller.session);
  app.post(base + '/identity/logout', controller.logout);
  app.post(base + '/identity/link', controller.link);
}
