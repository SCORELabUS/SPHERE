import express from 'express';
import NotificationController from '../controllers/NotificationController';

const loadFileRoutes = function (app: express.Application) {
  const notificationController = new NotificationController();
  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1';

  // SSE endpoint must be before parameterized routes
  app
    .route(baseUrl + '/notifications/stream')
    .get(notificationController.streamNotifications);

  app
    .route(baseUrl + '/notifications')
    .get(notificationController.getNotifications);

  app
    .route(baseUrl + '/notifications/unread-count')
    .get(notificationController.getUnreadCount);

  app
    .route(baseUrl + '/notifications/mark-all-read')
    .put(notificationController.markAllAsRead);

  app
    .route(baseUrl + '/notifications/:notificationId')
    .put(notificationController.markAsRead)
    .delete(notificationController.deleteNotification);
};

export default loadFileRoutes;
