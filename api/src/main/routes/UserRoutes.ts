import express from 'express';
import UserController from '../controllers/UserController';
import container from '../config/container';
import { addFilenameToBody, handleFileUpload } from '../middlewares/FileHandlerMiddleware';
import { handleValidation } from '../middlewares/ValidationHandlingMiddleware';
import * as UserValidation from '../controllers/validation/UserValidation';
import { checkEntityExists } from '../middlewares/EntityMiddleware';
import PricingCollectionController from '../controllers/PricingCollectionController';
import PricingController from '../controllers/PricingController';

const loadFileRoutes = function (app: express.Application) {
  const userController = new UserController();
  const pricingController = new PricingController();
  const collectionController = new PricingCollectionController();
  const userService = container.resolve('userService');
  const upload = handleFileUpload(['avatar'], (process.env.SERVER_STATICS_FOLDER || 'public/') + (process.env.AVATARS_FOLDER || 'static/avatars/users'));
  const baseUrl = (process.env.BASE_URL_PATH ?? "") + '/api/v1';

  app
      .route(baseUrl + '/users')
      .get(userController.index);

  app
    .route(baseUrl + '/users/register')
    .post(
      UserValidation.create,
      handleValidation,
      userController.register
    );

  app
    .route(baseUrl + '/users/login')
    .post(UserValidation.login, handleValidation, userController.login);

  // ============================================
  // /users/me routes (must come before /users/:username)
  // ============================================
  app
    .route(baseUrl + '/users/me')
    .get(userController.getCurrentUser);

  // ============================================
  // /users/me/settings routes (before /users/:username)
  // ============================================
  app
    .route(baseUrl + '/users/me/settings')
    .get(userController.getSettings)
    .put(userController.updateAccountSettings);

  app
    .route(baseUrl + '/users/me/settings/profile')
    .put(userController.updateProfile);

  app
    .route(baseUrl + '/users/me/settings/social-links')
    .put(userController.updateSocialLinks);

  app
    .route(baseUrl + '/users/me/settings/notifications')
    .put(userController.updateNotificationPrefs);

  app
    .route(baseUrl + '/users/me/settings/avatar')
    .post((req, res) => {
      userController.settingsUploadMiddleware(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE')
            return res.status(400).json({ error: 'File size must be less than 2MB' });
          return res.status(400).json({ error: err.message });
        }
        userController.uploadAvatar(req, res);
      });
    })
    .delete(userController.removeAvatar);

  app
    .route(baseUrl + '/users/me/settings/avatar-colors')
    .put(userController.updateAvatarColors);

  // ============================================
  // /users/:username routes (after /users/me)
  // ============================================
  app
    .route(baseUrl + '/users/:username')
    .get(checkEntityExists(userService, 'username'), userController.show)
    .put(
      checkEntityExists(userService, 'username'),
      upload,
      addFilenameToBody('avatar'),
      UserValidation.update,
      handleValidation,
      userController.update
    )
    .delete(checkEntityExists(userService, 'username'), userController.destroy);

  app
    .route(baseUrl + '/users/:username/pricings')
    .get(pricingController.indexByAuthenticatedUser);
  
  app
    .route(baseUrl + '/users/:username/collections')
    .get(collectionController.indexByAuthenticatedUser);
  
  app.route(baseUrl + '/users/:username/refresh-token').put(userController.updateToken);
};

export default loadFileRoutes;
