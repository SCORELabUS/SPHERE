import mongoose from 'mongoose';
import EntityPermissionMongoose from '../../../main/repositories/mongoose/models/EntityPermissionMongoose';
import { EntityType, EntityPermissions } from '../../../main/types/models/EntityPermission';
import testContainer from '../config/testContainer';

export const createEntityPermission = async (
  userId: string,
  organizationId: string,
  entityType: EntityType,
  entityId: string,
  permissions: EntityPermissions,
  grantedBy?: string
): Promise<any> => {
  const permission = new EntityPermissionMongoose({
    _userId: new mongoose.Types.ObjectId(userId),
    _organizationId: new mongoose.Types.ObjectId(organizationId),
    entityType,
    entitySlug: entityId,
    permissions,
    grantedBy: grantedBy ? new mongoose.Types.ObjectId(grantedBy) : undefined,
  });

  const saved = await permission.save();
  return saved.toObject({ getters: true, virtuals: true, versionKey: false });
};

export const grantPricingPermission = async (
  userId: string,
  organizationId: string,
  pricingId: string,
  permissions: EntityPermissions,
  grantedBy?: string
): Promise<any> => {
  return createEntityPermission(userId, organizationId, 'pricing', pricingId, permissions, grantedBy);
};

export const grantCollectionPermission = async (
  userId: string,
  organizationId: string,
  collectionId: string,
  permissions: EntityPermissions,
  grantedBy?: string
): Promise<any> => {
  return createEntityPermission(userId, organizationId, 'collection', collectionId, permissions, grantedBy);
};

export const cleanupPermissions = async (): Promise<void> => {
  await EntityPermissionMongoose.deleteMany({});
};
