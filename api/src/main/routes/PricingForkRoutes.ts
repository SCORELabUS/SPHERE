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
};

export default loadFileRoutes;
