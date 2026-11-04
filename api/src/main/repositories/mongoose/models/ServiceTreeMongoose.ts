import mongoose, { Schema } from 'mongoose';

// The services an organization offers, as a tree (beta, see ServiceTreeService).
// One document per organization; siblings keep the order of `nodes`.
const serviceNodeSchema = new Schema(
  {
    id: { type: String, required: true },
    parentId: { type: String, default: null },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    // AUTONOMOUS, DEPENDENT or a kind the organization made up; null while unclassified.
    kind: { type: String, default: null },
    // What the service depends on: FUNCTIONAL (the provider's functionality), ACCOUNT (an account in it) or any other text.
    dependency: { type: String, default: null },
    // Bound to pricing identities (pricingId), so links survive renames and collection moves.
    pricingIds: { type: [Schema.Types.ObjectId], ref: 'PricingIdentity', default: [] },
    // Free fields added by hand (e.g. in the JSON editor), so new kinds of data need no schema change.
    attributes: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false, minimize: false }
);

const serviceTreeSchema = new Schema(
  {
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    nodes: { type: [serviceNodeSchema], default: [] },
    // Optimistic concurrency: a save names the revision it was based on.
    revision: { type: Number, default: 0 },
    _updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

serviceTreeSchema.index({ _organizationId: 1 }, { unique: true });

const serviceTreeModel = mongoose.model('ServiceTree', serviceTreeSchema, 'serviceTrees');

export default serviceTreeModel;
