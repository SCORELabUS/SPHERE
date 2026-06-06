import express from 'express';
import PricingCollectionController from '../controllers/PricingCollectionController';
import { handleValidation } from '../middlewares/ValidationHandlingMiddleware';
import * as PricingCollectionValidator from '../controllers/validation/PricingCollectionValidation';
import { handleCollectionUpload } from '../middlewares/FileHandlerMiddleware';
import path from 'path';

const loadFileRoutes = function (app: express.Application) {
  const pricingCollectionController = new PricingCollectionController();

  const upload = handleCollectionUpload(
    ['zip'],
    path.resolve(process.cwd(), 'public', 'static', 'collections')
  );

  const baseUrl = (process.env.BASE_URL_PATH ?? "") + '/api/v1';

  app
    .route(baseUrl + '/collections')
    .get(pricingCollectionController.index);
    
    
  app
    .route(baseUrl + '/collections/:organizationId')
    .get(pricingCollectionController.indexByOrganizationId)
    .post(PricingCollectionValidator.create, handleValidation,pricingCollectionController.create);
    
  app
    .route(baseUrl + '/collections/:organizationId/bulk')
    .post(upload, pricingCollectionController.bulkCreate);
  
  app
    .route(baseUrl + '/collections/:organizationId/pricings')
    .post(upload, pricingCollectionController.addPricingToCollection);

  app
    .route(baseUrl + '/collections/:organizationId/:collectionSlug')
    .get(pricingCollectionController.show)
    .put(
      PricingCollectionValidator.update,
      handleValidation,
      pricingCollectionController.update
    )
    .delete(pricingCollectionController.destroy);

  app
    .route(baseUrl + '/collections/:organizationId/:collectionSlug/download')
    .get(pricingCollectionController.downloadCollection);

  app
    .route(baseUrl + '/collections/:organizationId/:collectionSlug/pricings/:pricingSlug')
    .delete(pricingCollectionController.removePricingFromCollection);
};

export default loadFileRoutes;
