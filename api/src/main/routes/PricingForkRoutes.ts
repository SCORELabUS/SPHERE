import express from 'express';
import PricingController from '../controllers/PricingController';

const loadFileRoutes = function (app: express.Application) {
  const pricingController = new PricingController();

  const baseUrl = (process.env.BASE_URL_PATH ?? "") + '/api/v1';

  // Kept outside of /pricings/** on purpose: that path always resolves to entity
  // type "pricing" in AuthorizationMiddleware, which would check CREATE permission
  // against the SOURCE organization instead of the target one. PricingService.forkPricing
  // performs its own permission checks (source visibility + target org CREATE).
  app
    .route(baseUrl + '/pricing-forks')
    .post(pricingController.fork);

  // The version graph of a pricing: its lane, the pricings its versions were forked
  // from and those forked from it. Outside /pricings/** so it cannot be taken for a
  // version named "graph"; PricingService.graph applies show()'s visibility rules.
  app
    .route(baseUrl + '/pricing-graphs/:organizationId/:pricingSlug')
    .get(pricingController.graph);
};

export default loadFileRoutes;
