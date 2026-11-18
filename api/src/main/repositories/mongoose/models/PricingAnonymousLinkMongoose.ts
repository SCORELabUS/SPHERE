import mongoose, { Schema } from 'mongoose';

// A link that shows one version of a pricing without naming who published it
// (see PricingAnonymousLinkService). Revoking a link deletes it, so a revoked
// token and one that never existed are the same case.
const pricingAnonymousLinkSchema = new Schema({
  // Random, never derived from an id (see ANONYMOUS_TOKEN_BYTES).
  token: { type: String, required: true, immutable: true },
  pricingId: { type: Schema.Types.ObjectId, ref: 'PricingIdentity', required: true, immutable: true },
  // A fixed version: a paper cites a snapshot, not "the latest".
  versionId: { type: Schema.Types.ObjectId, ref: 'Pricing', required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  createdAt: { type: Date, default: () => new Date(), immutable: true },
});

pricingAnonymousLinkSchema.index({ token: 1 }, { unique: true });
pricingAnonymousLinkSchema.index({ pricingId: 1, createdAt: -1 });
pricingAnonymousLinkSchema.index({ versionId: 1 });

const pricingAnonymousLinkModel = mongoose.model('PricingAnonymousLink', pricingAnonymousLinkSchema, 'pricingAnonymousLinks');

export default pricingAnonymousLinkModel;
