import express from 'express';
import PricingPullRequestController from '../controllers/PricingPullRequestController';
import * as PricingPullRequestValidator from '../controllers/validation/PricingPullRequestValidation';
import { handleValidation } from '../middlewares/ValidationHandlingMiddleware';
import { pricingPullRequestRateLimiter } from '../middlewares/RateLimitMiddleware';

const loadFileRoutes = function (app: express.Application) {
  const pricingPullRequestController = new PricingPullRequestController();
  const webSession = pricingPullRequestController.requireWebSession;

  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1/pricing-pull-requests';

  // An edit that only renames costs no parsing; one that sends a proposal parses it like POST /.
  const limitProposalEdits = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.body?.proposedYaml === undefined ? next() : pricingPullRequestRateLimiter(req, res, next);

  // Kept outside of /pricings/** on purpose, like /pricing-forks: there the middleware
  // would ask CREATE or PUT on the pricing of whoever only proposes, and a version named
  // "pull-requests" would clash with the route. PricingPullRequestService checks who may
  // read the pricing, propose to it and maintain it.
  app
    .route(baseUrl)
    .get(webSession, PricingPullRequestValidator.list, handleValidation, pricingPullRequestController.index)
    .post(
      webSession,
      pricingPullRequestRateLimiter,
      PricingPullRequestValidator.create,
      handleValidation,
      pricingPullRequestController.create
    );

  // Static routes before /:pullRequestId.
  app
    .route(baseUrl + '/fork-target')
    .get(webSession, PricingPullRequestValidator.forkTarget, handleValidation, pricingPullRequestController.forkTarget);

  app
    .route(baseUrl + '/previews')
    .post(
      webSession,
      pricingPullRequestRateLimiter,
      PricingPullRequestValidator.preview,
      handleValidation,
      pricingPullRequestController.preview
    );

  app
    .route(baseUrl + '/:pullRequestId')
    .get(webSession, PricingPullRequestValidator.show, handleValidation, pricingPullRequestController.show)
    .put(
      webSession,
      limitProposalEdits,
      PricingPullRequestValidator.update,
      handleValidation,
      pricingPullRequestController.update
    );

  app
    .route(baseUrl + '/:pullRequestId/merge-preview')
    .post(
      webSession,
      pricingPullRequestRateLimiter,
      PricingPullRequestValidator.mergePreview,
      handleValidation,
      pricingPullRequestController.mergePreview
    );

  app
    .route(baseUrl + '/:pullRequestId/update')
    .post(
      webSession,
      pricingPullRequestRateLimiter,
      PricingPullRequestValidator.updateToLatest,
      handleValidation,
      pricingPullRequestController.updateToLatest
    );

  app
    .route(baseUrl + '/:pullRequestId/merge')
    .post(
      webSession,
      pricingPullRequestRateLimiter,
      PricingPullRequestValidator.merge,
      handleValidation,
      pricingPullRequestController.merge
    );

  app
    .route(baseUrl + '/:pullRequestId/close')
    .post(webSession, PricingPullRequestValidator.close, handleValidation, pricingPullRequestController.close);
};

export default loadFileRoutes;
