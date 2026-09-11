import mongoose from 'mongoose';
import { LeanOrganization } from '../../types/models/Organization';
import RepositoryBase from '../RepositoryBase';
import OrganizationMongoose from './models/OrganizationMongoose';
import { escapeRegex } from '../../utils/regex';

class OrganizationRepository extends RepositoryBase {
  async findAll(queryParams: any) {
    try {
      const orgs = await OrganizationMongoose.find().sort({ createdAt: -1 });
      return orgs.map(org => org.toObject());
    } catch {
      return [];
    }
  }

  async findPublicRoots(options: { q?: string; limit: number; offset: number }) {
    const filter: Record<string, any> = {
      isPersonal: false,
      _parentId: null,
    };

    if (options.q) {
      const search = { $regex: escapeRegex(options.q), $options: 'i' };
      filter.$or = [{ name: search }, { displayName: search }, { description: search }];
    }

    const [organizations, total] = await Promise.all([
      OrganizationMongoose.find(filter)
        .select('-ancestors')
        .sort({ displayName: 1, createdAt: -1 })
        .skip(options.offset)
        .limit(options.limit)
        .lean({ getters: true, virtuals: false }),
      OrganizationMongoose.countDocuments(filter),
    ]);

    return {
      items: organizations.map(({ _id, __v, ...organization }: any) => ({
        ...organization,
        id: _id.toString(),
      })),
      total,
    };
  }
  
  async findOne(filter: any) {
    try {
      const org = await OrganizationMongoose.findOne(filter).exec();
      return org ? org.toObject() : null;
    } catch {
      return null;
    }
  }

  async findById(id: string) {
    try {
      const org = await OrganizationMongoose.findById(id).populate('subOrganizations');
      return org ? org.toObject() : null;
    } catch {
      return null;
    }
  }

  async create(data: any): Promise<LeanOrganization> {
    const org = await new OrganizationMongoose(data).save();
    return org.toObject<LeanOrganization>();
  }

  async update(id: string, data: any) {
    const org = await OrganizationMongoose.findOneAndUpdate({ _id: id }, data, { new: true });
    return org ? org.toObject() : null;
  }

  async destroy(id: string) {
    const result = await OrganizationMongoose.deleteOne({ _id: id });
    return result?.deletedCount === 1;
  }

  async findExistingSlug(name: string): Promise<boolean> {
    const existing = await OrganizationMongoose.findOne({ name }).collation({ locale: 'en', strength: 2 }).lean();
    return existing !== null;
  }

  async findChildOrganizationIds(parentId: string): Promise<string[]> {
    const children = await OrganizationMongoose.find({ _parentId: new mongoose.Types.ObjectId(parentId) })
      .select('_id')
      .lean();
    return children.map((c: any) => c._id.toString());
  }

  /**
   * Every organization below the given one, at any depth. The `ancestors` array
   * carries the whole chain, so one indexed query answers this without walking
   * the tree level by level.
   */
  async findDescendants(organizationId: string): Promise<Array<{ id: string; ancestors: string[] }>> {
    const descendants = await OrganizationMongoose.find({
      ancestors: new mongoose.Types.ObjectId(organizationId),
    })
      .select('_id ancestors')
      .lean();

    return descendants.map((descendant: any) => ({
      id: descendant._id.toString(),
      ancestors: (descendant.ancestors ?? []).map((ancestorId: any) => ancestorId.toString()),
    }));
  }

  /** Rewrites the ancestor chains of many organizations in a single round trip. */
  async updateAncestorsBulk(updates: Array<{ id: string; ancestors: string[] }>): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    await OrganizationMongoose.bulkWrite(
      updates.map(({ id, ancestors }) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(id) },
          update: {
            $set: { ancestors: ancestors.map(ancestorId => new mongoose.Types.ObjectId(ancestorId)) },
          },
        },
      }))
    );
  }
}

export default OrganizationRepository;
