import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import ServiceTreeMongoose from './models/ServiceTreeMongoose';
import PricingIdentityMongoose from './models/PricingIdentityMongoose';
import { ServiceNode, ServiceTree } from '../../types/models/ServiceTree';

function toServiceTree(doc: any): ServiceTree {
  return {
    nodes: (doc?.nodes ?? []).map((node: any) => ({
      id: node.id,
      parentId: node.parentId ?? null,
      name: node.name,
      description: node.description ?? '',
      kind: node.kind ?? null,
      dependency: node.dependency ?? null,
      pricingIds: (node.pricingIds ?? []).map(String),
      attributes: node.attributes ?? {},
    })),
    revision: doc?.revision ?? 0,
    updatedAt: doc?.updatedAt ?? null,
  };
}

class ServiceTreeRepository extends RepositoryBase {
  async findByOrganizationId(organizationId: string): Promise<ServiceTree> {
    const doc = await ServiceTreeMongoose.findOne({
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    }).lean();
    return toServiceTree(doc);
  }

  /**
   * Replaces the tree if it is still at `revision`, moving it on by one. Returns
   * null when someone else saved it in between.
   */
  async replace(organizationId: string, nodes: ServiceNode[], revision: number, userId: string): Promise<ServiceTree | null> {
    const _organizationId = new mongoose.Types.ObjectId(organizationId);
    const fields = {
      nodes: nodes.map(node => ({ ...node, pricingIds: node.pricingIds.map(id => new mongoose.Types.ObjectId(id)) })),
      _updatedBy: new mongoose.Types.ObjectId(userId),
    };
    try {
      if (revision === 0) {
        // The first save creates the tree, only if there is none yet: matching on the
        // organization alone, an existing tree is never overwritten, even where the
        // unique index is missing.
        const created = await ServiceTreeMongoose.updateOne(
          { _organizationId },
          { $setOnInsert: { ...fields, revision: 1 } },
          { upsert: true }
        );
        if (created.upsertedCount) return this.findByOrganizationId(organizationId);
      }
      const doc = await ServiceTreeMongoose.findOneAndUpdate(
        { _organizationId, revision },
        { $set: fields, $inc: { revision: 1 } },
        { new: true }
      ).lean();
      return doc ? toServiceTree(doc) : null;
    } catch (err: any) {
      // Two first saves at once: the unique index lets only one create the tree.
      if (err?.code === 11000) return null;
      throw err;
    }
  }

  /** The ids, among `pricingIds`, of live pricings of the organization. */
  async findOrganizationPricingIds(organizationId: string, pricingIds: string[]): Promise<Set<string>> {
    const ids = pricingIds.filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id));
    if (!ids.length) return new Set();
    const identities = await PricingIdentityMongoose.find({
      _id: { $in: ids },
      _organizationId: new mongoose.Types.ObjectId(organizationId),
      deleted: false,
    })
      .select('_id')
      .lean();
    return new Set(identities.map(identity => String(identity._id)));
  }

  async deleteByOrganizationId(organizationId: string): Promise<void> {
    await ServiceTreeMongoose.deleteOne({ _organizationId: new mongoose.Types.ObjectId(organizationId) });
  }
}

export default ServiceTreeRepository;
