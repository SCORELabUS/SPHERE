import express from 'express';
import OrbitController from '../controllers/OrbitController';

const loadFileRoutes = function (app: express.Application) {
  const orbitController = new OrbitController();
  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1';

  app.route(baseUrl + '/orbit/status').get(orbitController.status);

  app
    .route(baseUrl + '/orbit/conversations')
    .get(orbitController.listConversations)
    .post(orbitController.createConversation);

  app
    .route(baseUrl + '/orbit/conversations/:conversationId')
    .get(orbitController.showConversation)
    .delete(orbitController.deleteConversation);

  app
    .route(baseUrl + '/orbit/conversations/:conversationId/messages')
    .post(orbitController.sendMessage);

  app.route(baseUrl + '/orbit/plans/:planId').get(orbitController.showPlan);

  app.route(baseUrl + '/orbit/plans/:planId/confirm').post(orbitController.confirmPlan);

  app.route(baseUrl + '/orbit/plans/:planId/cancel').post(orbitController.cancelPlan);

  app
    .route(baseUrl + '/orbit/mcp')
    .post(orbitController.mcp)
    .get(orbitController.mcp)
    .delete(orbitController.mcp);
};

export default loadFileRoutes;
