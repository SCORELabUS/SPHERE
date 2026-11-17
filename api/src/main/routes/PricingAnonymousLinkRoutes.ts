import express from 'express';
import PricingAnonymousLinkController from '../controllers/PricingAnonymousLinkController';

const loadFileRoutes = function (app: express.Application) {
  const controller = new PricingAnonymousLinkController();

  const baseUrl = (process.env.BASE_URL_PATH ?? "") + '/api/v1';

  // Managing the anonymous links of a pricing. Outside /pricings/** so they
  // cannot be taken for a version name; PricingAnonymousLinkService checks
  // that the caller may edit the pricing.
  app
    .route(baseUrl + '/pricing-anonymous-links')
    .get(controller.list)
    .post(controller.create);

  app
    .route(baseUrl + '/pricing-anonymous-links/:linkId')
    .delete(controller.revoke);

  // What a link shows, to anyone and alike for everyone: the credentials of
  // these requests are dropped before authentication (AnonymousAccessMiddleware).
  app
    .route(baseUrl + '/anonymous-pricings/:token')
    .get(controller.show);

  app
    .route(baseUrl + '/anonymous-pricings/:token/yaml')
    .get(controller.yaml);
};

export default loadFileRoutes;
