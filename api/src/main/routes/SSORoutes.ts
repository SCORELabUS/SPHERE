import express from 'express';
import SSOController from '../controllers/SSOController';

const loadSSORoutes = function (app: express.Application) {
  const ssoController = new SSOController();
  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1';

  app.route(baseUrl + '/users/auth/sso/:provider/initiate').get(ssoController.initiate);
  app.route(baseUrl + '/users/auth/sso/:provider/callback').get(ssoController.callback);
  app.route(baseUrl + '/users/auth/sso/:provider/exchange').get(ssoController.exchange);
};

export default loadSSORoutes;
