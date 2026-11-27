import express from 'express';
import OrganizationController from '../controllers/OrganizationController';
import PricingCollectionController from '../controllers/PricingCollectionController';
import PricingController from '../controllers/PricingController';
import ServiceTreeController from '../controllers/ServiceTreeController';
import { requireBetaFeatures } from '../middlewares/BetaFeaturesMiddleware';

/**
 * An organization read as one of its members gets it, so that its owners and
 * admins can check what that member sees. Read-only; who may ask, and about
 * whom, is settled by `OrganizationMemberViewService`.
 */
const loadFileRoutes = function (app: express.Application) {
  const organizationController = new OrganizationController();
  const pricingController = new PricingController();
  const pricingCollectionController = new PricingCollectionController();
  const serviceTreeController = new ServiceTreeController();
  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1';
  const memberView = baseUrl + '/orgs/:organizationId/member-views/:userId';

  app.route(memberView + '/pricings').get(pricingController.indexByOrganizationAsMember);
  app.route(memberView + '/collections').get(pricingCollectionController.indexByOrganizationAsMember);
  // The services are a beta feature of whoever is looking.
  app.route(memberView + '/services').get(requireBetaFeatures, serviceTreeController.showAsMember);
  app.route(memberView + '/hierarchy').get(organizationController.hierarchyAsMember);
};

export default loadFileRoutes;
