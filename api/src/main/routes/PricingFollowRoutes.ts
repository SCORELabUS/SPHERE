import express from 'express';
import PricingFollowController from '../controllers/PricingFollowController';

const loadFileRoutes = function (app: express.Application) {
  const pricingFollowController = new PricingFollowController();

  const baseUrl = (process.env.BASE_URL_PATH ?? "") + '/api/v1';

  // Kept outside of /pricings/** on purpose, like /pricing-forks: that path checks entity
  // permissions on the pricing (PUT/DELETE), which a follower who can only view it lacks.
  // PricingFollowService applies the pricing's visibility rule itself.
  app
    .route(baseUrl + '/pricing-follows/:organizationId/:pricingSlug')
    .get(pricingFollowController.status)
    .put(pricingFollowController.follow)
    .delete(pricingFollowController.unfollow);
};

export default loadFileRoutes;
