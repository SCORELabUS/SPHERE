import mongoose, { Schema } from 'mongoose';

// A user following a pricing to be notified of its new versions. Bound to the pricing's
// identity (pricingId), so a follow survives renames of the pricing.
const pricingFollowSchema = new Schema(
  {
    _userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pricingId: { type: Schema.Types.ObjectId, ref: 'PricingIdentity', required: true },
  },
  { timestamps: true }
);

pricingFollowSchema.index({ _userId: 1, pricingId: 1 }, { unique: true });
pricingFollowSchema.index({ pricingId: 1 });

const pricingFollowModel = mongoose.model('PricingFollow', pricingFollowSchema, 'pricingFollows');

export default pricingFollowModel;
