import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import OrganizationMembershipMongoose from './models/OrganizationMembershipMongoose';
import { OrgRole, ROLE_WEIGHT } from '../../types/models/Organization';
import { getUserOrganizationsByUserAggregator } from './aggregators/organizations/getUserOrganizationsByUser';
import { OrganizationIndexByUserOptions } from '../../types/services/Organization';

class OrganizationMembershipRepository extends RepositoryBase {
  async findByUserId(userId: string, includeSubOrgs = false) {
    try {
      return await OrganizationMembershipMongoose.aggregate([
        { $match: { _userId: new mongoose.Types.ObjectId(userId) } },
        {
          $lookup: {
            from: 'organizations',
            localField: '_organizationId',
            foreignField: '_id',
            as: 'organization',
          },
        },
        { $unwind: '$organization' },
        {
          $addFields: {
            id: { $toString: '$_id' },
            'organization.id': { $toString: '$organization._id' },
          },
        },
        ...(!includeSubOrgs
          ? [
              {
                $match: {
                  'organization._parentId': null,
                },
              },
            ]
          : []),
        {
          $project: {
            _id: 0,
            id: 1,
            _userId: 1,
            _organizationId: 1,
            role: 1,
            joinedAt: 1,
            organization: {
              id: 1,
              name: 1,
              displayName: 1,
              avatar: 1,
              isPersonal: 1,
              _parentId: 1,
              ancestors: 1,
            },
          },
        },
      ]);
    } catch {
      return [];
    }
  }

  async findOrganizationsByUserId(userId: string, options: OrganizationIndexByUserOptions) {
    try {
      if (options.treeFormat) {
        const flatPipeline = getUserOrganizationsByUserAggregator(userId, { ...options, treeFormat: false, pagination: undefined });
        const flatOrgs = await OrganizationMembershipMongoose.aggregate(flatPipeline);
        const tree = this.buildOrgTree(flatOrgs);

        if (options.pagination && (typeof options.pagination.limit !== 'undefined' || typeof options.pagination.offset !== 'undefined')) {
          const offset = options.pagination.offset ?? 0;
          const limit = options.pagination.limit ?? 10;
          return {
            items: tree.slice(offset, offset + limit),
            total: tree.length,
          };
        }

        return { items: tree, total: tree.length };
      }

      const pipeline = getUserOrganizationsByUserAggregator(userId, options);
      const result = await OrganizationMembershipMongoose.aggregate(pipeline);

      if (options.pagination && (typeof options.pagination.limit !== 'undefined' || typeof options.pagination.offset !== 'undefined')) {
        const facet = result[0] || { items: [], total: [] };
        return {
          items: facet.items,
          total: facet.total[0]?.count ?? 0,
        };
      }

      return { items: result, total: result.length };
    } catch (error){
      console.log(error);
      return { items: [], total: 0 };
    }
  }

  private buildOrgTree(flatOrgs: any[]): any[] {
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const org of flatOrgs) {
      map.set(org.id, { ...org, subOrganizations: [] });
    }

    for (const org of flatOrgs) {
      const node = map.get(org.id)!;
      if (org._parentId && map.has(org._parentId)) {
        map.get(org._parentId)!.subOrganizations.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (nodes: any[]): any[] => {
      nodes.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
      for (const node of nodes) {
        if (node.subOrganizations?.length) {
          sortNodes(node.subOrganizations);
        }
      }
      return nodes;
    };

    return sortNodes(roots);
  }

  async findByOrganizationId(organizationId: string) {
    try {
      return await OrganizationMembershipMongoose.aggregate([
        { $match: { _organizationId: new mongoose.Types.ObjectId(organizationId) } },
        {
          $lookup: {
            from: 'users',
            localField: '_userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $addFields: {
            id: { $toString: '$_id' },
            _userId: { $toString: '$_userId' },
            _organizationId: {
              $toString: '$_organizationId',
            },
            'user.id': {
              $toString: '$user._id',
            },
          },
        },
        {
          $addFields: {
            'user.avatarBgColor': { $ifNull: ['$user.settings.avatarBgColor', '#fa520f'] },
            'user.avatarFgColor': { $ifNull: ['$user.settings.avatarFgColor', '#ffffff'] },
          },
        },
        {
          $project: {
            _id: 0,
            id: 1,
            _userId: 1,
            _organizationId: 1,
            role: 1,
            joinedAt: 1,
            user: {
              id: 1,
              username: 1,
              email: 1,
              avatar: '$user.settings.avatar',
              avatarBgColor: 1,
              avatarFgColor: 1,
            },
          },
        },
      ]);
    } catch {
      return [];
    }
  }

  async findUserRoleInOrganization(
    userId: string,
    organizationId: string
  ): Promise<OrgRole | null> {
    try {
      const targetOrgObjectId = new mongoose.Types.ObjectId(organizationId);
      const userObjectId = new mongoose.Types.ObjectId(userId);

      const membership = await OrganizationMembershipMongoose.aggregate([
        {
          $lookup: {
            from: 'organizations',
            let: { targetOrgId: targetOrgObjectId },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$targetOrgId'] } } },
              { $project: { ancestors: 1 } },
            ],
            as: 'targetOrg',
          },
        },
        { $unwind: '$targetOrg' },
        {
          $match: {
            _userId: userObjectId,
            $expr: {
              $in: [
                '$_organizationId',
                {
                  $concatArrays: [[targetOrgObjectId], { $ifNull: ['$targetOrg.ancestors', []] }],
                },
              ],
            },
          },
        },
        {
          $addFields: {
            isDirect: { $eq: ['$_organizationId', targetOrgObjectId] },
            roleWeight: {
              $switch: {
                branches: [
                  { case: { $eq: ['$role', 'OWNER'] }, then: 3 },
                  { case: { $eq: ['$role', 'ADMIN'] }, then: 2 },
                  { case: { $eq: ['$role', 'MEMBER'] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
        },
        {
          $match: {
            $expr: {
              $or: [{ $eq: ['$isDirect', true] }, { $in: ['$role', ['OWNER', 'ADMIN']] }],
            },
          },
        },
        { $sort: { roleWeight: -1 } },
        { $limit: 1 },
      ]);
      return membership.length > 0 ? membership[0].role : null;
    } catch (err) {
      return null;
    }
  }

  async findRolesByUserId(userId: string): Promise<Map<string, OrgRole>> {
    const memberships = await OrganizationMembershipMongoose.find({
      _userId: new mongoose.Types.ObjectId(userId),
    }).select('_organizationId role').lean();

    const roles = new Map<string, OrgRole>();
    for (const m of memberships) {
      const orgId = (m._organizationId as unknown as mongoose.Types.ObjectId).toHexString();
      roles.set(orgId, m.role as OrgRole);
    }
    return roles;
  }

  async create(data: any) {
    const membership = new OrganizationMembershipMongoose(data);
    await membership.save();
    return membership.toObject({ getters: true, virtuals: true, versionKey: false });
  }

  async findByUserAndOrganization(userId: string, organizationId: string) {
    return OrganizationMembershipMongoose.findOne({
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    });
  }

  async updateByUserAndOrganization(userId: string, organizationId: string, data: any) {
    if (data.role) {
      data._roleWeight = ROLE_WEIGHT[data.role as keyof typeof ROLE_WEIGHT] ?? 0;
    }
    return OrganizationMembershipMongoose.findOneAndUpdate(
      {
        _userId: new mongoose.Types.ObjectId(userId),
        _organizationId: new mongoose.Types.ObjectId(organizationId),
      },
      data,
      { new: true }
    );
  }

  async countOwners(organizationId: string): Promise<number> {
    return OrganizationMembershipMongoose.countDocuments({
      _organizationId: new mongoose.Types.ObjectId(organizationId),
      role: 'OWNER',
    });
  }

  async destroyByUserAndOrganization(userId: string, organizationId: string) {
    const result = await OrganizationMembershipMongoose.deleteOne({
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    });
    return result?.deletedCount === 1;
  }

  async destroyByOrganizationId(organizationId: string) {
    await OrganizationMembershipMongoose.deleteMany({
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    });
    return true;
  }

  async destroyByUserId(userId: string) {
    await OrganizationMembershipMongoose.deleteMany({
      _userId: new mongoose.Types.ObjectId(userId),
    });
    return true;
  }

  async findDirectMemberships(organizationId: string) {
    return OrganizationMembershipMongoose.find({
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    }).lean();
  }

  async findExistingMembership(userId: string, organizationId: string) {
    return OrganizationMembershipMongoose.findOne({
      _userId: new mongoose.Types.ObjectId(userId),
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    }).lean();
  }

  async createBulk(
    memberships: Array<{ _userId: string; _organizationId: string; role: OrgRole; joinedAt: Date }>
  ) {
    const docs = memberships.map(m => ({
      _userId: new mongoose.Types.ObjectId(m._userId),
      _organizationId: new mongoose.Types.ObjectId(m._organizationId),
      role: m.role,
      joinedAt: m.joinedAt,
    }));
    return OrganizationMembershipMongoose.insertMany(docs, { ordered: false }).catch(() => []);
  }

  async destroyByUserAndOrganizationBatch(userIds: string[], organizationId: string) {
    if (userIds.length === 0) return;
    await OrganizationMembershipMongoose.deleteMany({
      _userId: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) },
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    });
  }
}

export default OrganizationMembershipRepository;
