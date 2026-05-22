import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import EntityPermissionMongoose from './models/EntityPermissionMongoose';
import PricingMongoose from './models/PricingMongoose';
import PricingCollectionMongoose from './models/PricingCollectionMongoose';
import { EntityType, EntityPermissions, LeanEntityPermission } from '../../types/models/EntityPermission';

class EntityPermissionRepository extends RepositoryBase {
  async findByUserAndOrganization(
    userId: string,
    organizationId: string,
    entityType?: EntityType
  ): Promise<LeanEntityPermission[]> {
    const match: any = {
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    };
    if (entityType) {
      match.entityType = entityType;
    }

    const results = await EntityPermissionMongoose.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'pricings',
          localField: 'entityId',
          foreignField: '_id',
          as: 'pricingEntity',
          pipeline: [{ $project: { name: 1, _organizationId: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'pricingCollections',
          localField: 'entityId',
          foreignField: '_id',
          as: 'collectionEntity',
          pipeline: [{ $project: { name: 1, _organizationId: 1 } }],
        },
      },
      {
        $addFields: {
          id: { $toString: '$_id' },
          _userId: { $toString: '$_userId' },
          _organizationId: { $toString: '$_organizationId' },
          entityId: {
            $cond: [{ $ifNull: ['$entityId', null] }, { $toString: '$entityId' }, null]
          },
          grantedBy: { $cond: [{ $ifNull: ['$grantedBy', null] }, { $toString: '$grantedBy' }, null] },
          entityName: {
            $cond: [
              { $eq: ['$entityType', 'pricing'] },
              { $arrayElemAt: ['$pricingEntity.name', 0] },
              { $arrayElemAt: ['$collectionEntity.name', 0] },
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          _userId: 1,
          _organizationId: 1,
          entityType: 1,
          entityId: 1,
          permissions: 1,
          grantedBy: 1,
          entityName: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      { $sort: { entityName: 1 } },
    ]);

    return results as LeanEntityPermission[];
  }

  async findByEntity(
    entityType: EntityType,
    entityId: string
  ): Promise<LeanEntityPermission[]> {
    const results = await EntityPermissionMongoose.aggregate([
      {
        $match: {
          entityType,
          entityId: new mongoose.Types.ObjectId(entityId),
        },
      },
      {
        $addFields: {
          id: { $toString: '$_id' },
          _userId: { $toString: '$_userId' },
          _organizationId: { $toString: '$_organizationId' },
          entityId: { $toString: '$entityId' },
          grantedBy: { $cond: [{ $ifNull: ['$grantedBy', null] }, { $toString: '$grantedBy' }, null] },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_userId',
          foreignField: '_id',
          as: 'user',
          pipeline: [{ $project: { username: 1, email: 1 } }],
        },
      },
      {
        $addFields: {
          userName: { $arrayElemAt: ['$user.username', 0] },
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          _userId: 1,
          _organizationId: 1,
          entityType: 1,
          entityId: 1,
          permissions: 1,
          grantedBy: 1,
          userName: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ]);

    return results as LeanEntityPermission[];
  }

  async findByOrganization(
    organizationId: string,
    entityType?: EntityType
  ): Promise<LeanEntityPermission[]> {
    const match: any = {
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    };
    if (entityType) {
      match.entityType = entityType;
    }

    const results = await EntityPermissionMongoose.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: '_userId',
          foreignField: '_id',
          as: 'user',
          pipeline: [{ $project: { username: 1, email: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'pricings',
          localField: 'entityId',
          foreignField: '_id',
          as: 'pricingEntity',
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      {
        $lookup: {
          from: 'pricingCollections',
          localField: 'entityId',
          foreignField: '_id',
          as: 'collectionEntity',
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      {
        $addFields: {
          id: { $toString: '$_id' },
          _userId: { $toString: '$_userId' },
          _organizationId: { $toString: '$_organizationId' },
          entityId: {
            $cond: [{ $ifNull: ['$entityId', null] }, { $toString: '$entityId' }, null]
          },
          grantedBy: { $cond: [{ $ifNull: ['$grantedBy', null] }, { $toString: '$grantedBy' }, null] },
          userName: { $arrayElemAt: ['$user.username', 0] },
          entityName: {
            $cond: [
              { $eq: ['$entityType', 'pricing'] },
              { $arrayElemAt: ['$pricingEntity.name', 0] },
              { $arrayElemAt: ['$collectionEntity.name', 0] },
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          _userId: 1,
          _organizationId: 1,
          entityType: 1,
          entityId: 1,
          permissions: 1,
          grantedBy: 1,
          userName: 1,
          entityName: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      { $sort: { userName: 1, entityName: 1 } },
    ]);

    return results as LeanEntityPermission[];
  }

  private async resolveEntityId(
    entityType: EntityType,
    entityId: string,
    organizationId: string
  ): Promise<mongoose.Types.ObjectId | null> {
    if (mongoose.Types.ObjectId.isValid(entityId)) {
      return new mongoose.Types.ObjectId(entityId);
    }
    if (entityType === 'pricing') {
      const pricing = await PricingMongoose.findOne({ name: entityId, _organizationId: new mongoose.Types.ObjectId(organizationId) }).select('_id');
      if (!pricing) throw new Error(`Pricing "${entityId}" not found in this organization`);
      return pricing._id;
    }
    const collection = await PricingCollectionMongoose.findOne({ name: entityId, _organizationId: new mongoose.Types.ObjectId(organizationId) }).select('_id');
    if (!collection) throw new Error(`Collection "${entityId}" not found in this organization`);
    return collection._id;
  }

  async findOrCreate(
    userId: string,
    organizationId: string,
    entityType: EntityType,
    entityId: string | null,
    permissions: EntityPermissions,
    grantedBy?: string
  ): Promise<LeanEntityPermission> {
    const match: any = {
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
      entityType,
    };

    if (entityId) {
      match.entityId = await this.resolveEntityId(entityType, entityId, organizationId);
    } else {
      match.entityId = null;
    }

    const update: any = {
      permissions,
    };
    if (grantedBy) {
      update.grantedBy = new mongoose.Types.ObjectId(grantedBy);
    }

    const result = await EntityPermissionMongoose.findOneAndUpdate(
      match,
      { $set: update },
      { new: true, upsert: true }
    );

    return result.toObject({ getters: true, virtuals: true, versionKey: false }) as unknown as LeanEntityPermission;
  }

  async findByUserEntityAndOrganization(
    userId: string,
    organizationId: string,
    entityType: EntityType,
    entityId: string
  ): Promise<LeanEntityPermission | null> {
    const result = await EntityPermissionMongoose.findOne({
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
      entityType,
      entityId: new mongoose.Types.ObjectId(entityId),
    });

    if (!result) return null;
    return result.toObject({ getters: true, virtuals: true, versionKey: false }) as unknown as LeanEntityPermission;
  }

  async findByUserAndOrgScopedType(
    userId: string,
    organizationId: string,
    entityType: EntityType
  ): Promise<LeanEntityPermission | null> {
    const result = await EntityPermissionMongoose.findOne({
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
      entityType,
      entityId: null,
    });

    if (!result) return null;
    return result.toObject({ getters: true, virtuals: true, versionKey: false }) as unknown as LeanEntityPermission;
  }

  async findByUser(userId: string): Promise<LeanEntityPermission[]> {
    const results = await EntityPermissionMongoose.aggregate([
      { $match: { _userId: new mongoose.Types.ObjectId(userId) } },
      {
        $addFields: {
          id: { $toString: '$_id' },
          _userId: { $toString: '$_userId' },
          _organizationId: { $toString: '$_organizationId' },
          entityId: {
            $cond: [{ $ifNull: ['$entityId', null] }, { $toString: '$entityId' }, null],
          },
          grantedBy: {
            $cond: [{ $ifNull: ['$grantedBy', null] }, { $toString: '$grantedBy' }, null],
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          _userId: 1,
          _organizationId: 1,
          entityType: 1,
          entityId: 1,
          permissions: 1,
          grantedBy: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ]);

    return results as LeanEntityPermission[];
  }

  async destroy(permissionId: string): Promise<boolean> {
    const result = await EntityPermissionMongoose.deleteOne({
      _id: new mongoose.Types.ObjectId(permissionId),
    });
    return result?.deletedCount === 1;
  }

  async destroyByEntity(entityType: EntityType, entityId: string): Promise<void> {
    await EntityPermissionMongoose.deleteMany({
      entityType,
      entityId: new mongoose.Types.ObjectId(entityId),
    });
  }

  async destroyByUserAndOrganization(userId: string, organizationId: string): Promise<void> {
    await EntityPermissionMongoose.deleteMany({
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    });
  }

  async countByEntity(entityType: EntityType, entityId: string): Promise<number> {
    return EntityPermissionMongoose.countDocuments({
      entityType,
      entityId: new mongoose.Types.ObjectId(entityId),
    });
  }
}

export default EntityPermissionRepository;
