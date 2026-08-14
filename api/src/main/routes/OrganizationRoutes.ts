import express from 'express';
import OrganizationController from '../controllers/OrganizationController';
import { addFilenameToBody, handleFileUpload } from '../middlewares/FileHandlerMiddleware';
import { handleValidation } from '../middlewares/ValidationHandlingMiddleware';
import * as OrganizationValidation from '../controllers/validation/OrganizationValidation';

const loadFileRoutes = function (app: express.Application) {
  const organizationController = new OrganizationController();
  const baseUrl = (process.env.BASE_URL_PATH ?? '') + '/api/v1';
  const orgAvatarUpload = handleFileUpload(['avatar'], (process.env.SERVER_STATICS_FOLDER || 'public/') + (process.env.ORG_AVATARS_FOLDER || 'static/avatars/orgs'));

  app
    .route(baseUrl + '/users/me/orgs')
    .get(organizationController.indexByUser);

  app
    .route(baseUrl + '/orgs')
    .get(organizationController.index)
    .post(OrganizationValidation.create, handleValidation, organizationController.create);

  app
    .route(baseUrl + '/orgs/public')
    .get(organizationController.indexPublicRoots);

  app
    .route(baseUrl + '/orgs/invitations/preview/:code')
    .get(organizationController.previewInvitation);

  app.route(baseUrl + '/orgs/join/:code').post(organizationController.joinViaInvitation);

  app
    .route(baseUrl + '/orgs/:organizationId')
    .get(organizationController.show)
    .put(
      orgAvatarUpload,
      addFilenameToBody('avatar'),
      OrganizationValidation.update,
      handleValidation,
      organizationController.update
    )
    .delete(organizationController.destroy);

  app
    .route(baseUrl + '/orgs/:organizationId/members')
    .get(organizationController.listMembers)
    .post(OrganizationValidation.addMember, handleValidation, organizationController.addMember)
    .put(
      OrganizationValidation.addMembersBulk,
      handleValidation,
      organizationController.addMembersBulk
    );

  app
    .route(baseUrl + '/orgs/:organizationId/members/:userId')
    .put(
      OrganizationValidation.updateMemberRole,
      handleValidation,
      organizationController.updateMemberRole
    )
    .delete(organizationController.removeMember);

  app
    .route(baseUrl + '/orgs/:organizationId/invitations')
    .get(organizationController.listInvitations)
    .post(organizationController.createInvitation);

  app
    .route(baseUrl + '/orgs/:organizationId/invitations/invite-users')
    .post(organizationController.inviteUsers);

  app
    .route(baseUrl + '/orgs/:organizationId/invitations/:invitationId')
    .delete(organizationController.revokeInvitation);
};

export default loadFileRoutes;
