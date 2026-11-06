import express from 'express';
import ServiceTreeController from '../controllers/ServiceTreeController';
import { requireBetaFeatures } from '../middlewares/BetaFeaturesMiddleware';

const loadFileRoutes = function (app: express.Application) {
  const serviceTreeController = new ServiceTreeController();

  const baseUrl = (process.env.BASE_URL_PATH ?? "") + '/api/v1';

  // Beta: only for users who turned beta features on.
  app
    .route(baseUrl + '/orgs/:organizationId/services')
    .get(requireBetaFeatures, serviceTreeController.show)
    .put(requireBetaFeatures, serviceTreeController.replace);
};

export default loadFileRoutes;
