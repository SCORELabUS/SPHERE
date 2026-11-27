import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import PricingAnonymousLinkMongoose from './models/PricingAnonymousLinkMongoose';
import PricingMongoose from './models/PricingMongoose';
import PricingIdentity from './models/PricingIdentityMongoose';

export interface StoredAnonymousLink {
  _id: mongoose.Types.ObjectId;
  token: string;
  pricingId: mongoose.Types.ObjectId;
  versionId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

export interface ShareableVersion {
  _id: mongoose.Types.ObjectId;
  version: string;
  createdAt: Date;
  yaml: string;
  analytics?: Record<string, unknown>;
}

class PricingAnonymousLinkRepository extends RepositoryBase {
  async create(link: { token: string; pricingId: unknown; versionId: unknown; createdBy: unknown }): Promise<StoredAnonymousLink> {
    const created = await PricingAnonymousLinkMongoose.create(link);
    return created.toObject() as unknown as StoredAnonymousLink;
  }

  async findByToken(token: string): Promise<StoredAnonymousLink | null> {
    return PricingAnonymousLinkMongoose.findOne({ token }).lean<StoredAnonymousLink>();
  }

  async findById(id: string): Promise<StoredAnonymousLink | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return PricingAnonymousLinkMongoose.findById(id).lean<StoredAnonymousLink>();
  }

  /** The links of a pricing, newest first. */
  async listByPricing(pricingId: unknown): Promise<StoredAnonymousLink[]> {
    return PricingAnonymousLinkMongoose.find({ pricingId }).sort({ createdAt: -1, _id: -1 }).lean<StoredAnonymousLink[]>();
  }

  async countByPricing(pricingId: unknown): Promise<number> {
    return PricingAnonymousLinkMongoose.countDocuments({ pricingId });
  }

  async deleteById(id: unknown): Promise<void> {
    await PricingAnonymousLinkMongoose.deleteOne({ _id: id });
  }

  /** Whether the version is still stored in that pricing, and if it is private; null when it is gone. */
  async versionState(versionId: unknown, pricingId: unknown): Promise<{ private: boolean } | null> {
    const version = await PricingMongoose.findOne({ _id: versionId, pricingId }).select('private').lean<{ private?: boolean }>();
    return version ? { private: version.private === true } : null;
  }

  /** The label and visibility of these versions, by id. */
  async findVersions(ids: unknown[]): Promise<Map<string, { version: string; private: boolean }>> {
    const versions = await PricingMongoose.find({ _id: { $in: ids } }).select('version private').lean();
    return new Map(versions.map((version: any) => [String(version._id), { version: version.version, private: version.private === true }]));
  }

  /**
   * The version a link shows, while it can be shown: it still exists in the
   * same pricing, is not private and its pricing is not deleted.
   */
  async findShareableVersion(link: StoredAnonymousLink): Promise<ShareableVersion | null> {
    const version = await PricingMongoose.findOne({ _id: link.versionId, pricingId: link.pricingId, private: false })
      .select('version createdAt yaml analytics')
      .lean<ShareableVersion>();
    if (!version) return null;
    if (!(await PricingIdentity.exists({ _id: link.pricingId, deleted: false }))) return null;
    return version;
  }

  /**
   * Whether a link may still show what was read for it: the link was not
   * revoked, and its version is still public, in a live pricing and with the
   * same file, after the file was read.
   */
  async isStillShareable(link: StoredAnonymousLink, version: ShareableVersion): Promise<boolean> {
    if (!(await PricingAnonymousLinkMongoose.exists({ _id: link._id }))) return false;
    const unchanged = await PricingMongoose.exists({ _id: version._id, pricingId: link.pricingId, private: false, yaml: version.yaml });
    if (!unchanged) return false;
    return Boolean(await PricingIdentity.exists({ _id: link.pricingId, deleted: false }));
  }
}

export default PricingAnonymousLinkRepository;
