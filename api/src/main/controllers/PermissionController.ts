import container from '../config/container';
import PermissionService from '../services/PermissionService';
import { EntityType, EntityPermissions } from '../types/models/EntityPermission';
import { handleError } from '../utils/users/helpers';

class PermissionController {
  private permissionService: PermissionService;

  constructor() {
    this.permissionService = container.resolve('permissionService');
    this.getOrgPermissions = this.getOrgPermissions.bind(this);
    this.setPermission = this.setPermission.bind(this);
    this.setPermissionsBulk = this.setPermissionsBulk.bind(this);
    this.removePermission = this.removePermission.bind(this);
    this.getPricingPermissions = this.getPricingPermissions.bind(this);
    this.getCollectionPermissions = this.getCollectionPermissions.bind(this);
  }

  async getOrgPermissions(req: any, res: any) {
    try {
      const entityType = req.query.entityType as EntityType | undefined;
      const permissions = await this.permissionService.getOrganizationPermissions(
        req.params.orgId,
        entityType,
        req.user.id,
        req.user.role === 'ADMIN'
      );
      res.json(permissions);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async setPermission(req: any, res: any) {
    try {
      const { userId, entityType, entitySlug, permissions } = req.body;
      const result = await this.permissionService.setPermission(
        req.params.orgId,
        userId,
        entityType as EntityType,
        entitySlug ?? null,
        permissions as EntityPermissions,
        req.user.id,
        req.user.orgRole
      );
      res.status(201).json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async setPermissionsBulk(req: any, res: any) {
    try {
      const result = await this.permissionService.setPermissionsBulk(
        req.params.orgId,
        req.body.permissions,
        req.user.id,
        req.user.orgRole,
        req.user.role === 'ADMIN'
      );
      res.status(200).json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async removePermission(req: any, res: any) {
    try {
      const result = await this.permissionService.removePermission(
        req.params.permissionId,
        req.user.orgRole
      );
      if (!result) {
        res.status(404).send({ error: 'NOT FOUND: Permission not found' });
      } else {
        res.status(200).send({ message: 'Permission removed successfully' });
      }
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async getPricingPermissions(req: any, res: any) {
    try {
      const result = await this.permissionService.getPricingPermissions(
        req.user.id,
        req.params.organizationId,
        req.params.pricingSlug,
        req.user.orgRole
      );
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async getCollectionPermissions(req: any, res: any) {
    try {
      const result = await this.permissionService.getCollectionPermissions(
        req.user.id,
        req.params.organizationId,
        req.params.collectionSlug,
        req.user.orgRole
      );
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }
}

export default PermissionController;
