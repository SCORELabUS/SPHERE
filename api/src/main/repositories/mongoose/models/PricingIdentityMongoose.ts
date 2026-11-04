import mongoose, { Schema } from 'mongoose';

const schema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true },
  _organizationId: { type: Schema.Types.ObjectId, required: true },
  _collectionId: { type: String, default: null },
  deleted: { type: Boolean, default: false },
  // Optimistic concurrency: moves on with every write to any version of the
  // pricing, and is what its ETag names (see utils/pricing-etag.ts).
  revision: { type: Number, default: 0 },
});
schema.index({ _organizationId: 1, slug: 1, _collectionId: 1 }, {
  unique: true, partialFilterExpression: { deleted: false },
});
export default mongoose.model('PricingIdentity', schema, 'pricingIdentities');
