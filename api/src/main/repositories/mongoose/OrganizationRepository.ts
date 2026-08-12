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
}

export default OrganizationRepository;
