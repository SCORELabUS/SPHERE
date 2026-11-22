import mongoose, { Schema } from 'mongoose';
import { PULL_REQUEST_STATUSES } from '../../../types/models/PricingPullRequest';

// A proposed new version of a pricing (see types/models/PricingPullRequest.ts).
// Bound to the pricing's identity (pricingId), so it survives renames and moves;
// `refreshIdentities` (PricingMongoose) deletes them once the pricing is gone.
const pricingPullRequestSchema = new Schema(
  {
    pricingId: { type: Schema.Types.ObjectId, ref: 'PricingIdentity', required: true, immutable: true },
    number: { type: Number, required: true, immutable: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    status: { type: String, enum: PULL_REQUEST_STATUSES, required: true, default: 'open' },
    base: {
      type: {
        versionId: { type: Schema.Types.ObjectId, ref: 'Pricing', required: true },
        version: { type: String, required: true },
        yaml: { type: String, required: true },
      },
      required: true,
      _id: false,
    },
    proposed: {
      type: {
        yaml: { type: String, required: true },
        suggestedVersion: { type: String, required: true },
      },
      required: true,
      _id: false,
    },
    proposalRevision: { type: Number, required: true, default: 1 },
    origin: {
      type: {
        pricingId: { type: Schema.Types.ObjectId, ref: 'PricingIdentity', required: true },
        versionId: { type: Schema.Types.ObjectId, ref: 'Pricing', required: true },
        version: { type: String, required: true },
        baseVersionId: { type: Schema.Types.ObjectId, ref: 'Pricing', required: true },
        edited: { type: Boolean, default: false },
      },
      required: false,
      _id: false,
    },
    // Taken by a merge before it publishes; lapses at `until`. Internal.
    mergeLock: {
      type: {
        id: { type: String, required: true },
        byId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        until: { type: Date, required: true },
        revision: { type: Number, required: true },
        followedVersionId: { type: Schema.Types.ObjectId, ref: 'Pricing', required: false },
        followedVersion: { type: String, required: false },
        followedYaml: { type: String, required: false },
        mergedYaml: { type: String, required: false },
      },
      required: false,
      _id: false,
    },
    merged: {
      type: {
        byId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        at: { type: Date, required: true },
        versionId: { type: Schema.Types.ObjectId, ref: 'Pricing', required: true },
        version: { type: String, required: true },
        proposalRevision: { type: Number, required: true },
        followedVersionId: { type: Schema.Types.ObjectId, ref: 'Pricing', required: false },
        followedVersion: { type: String, required: false },
        followedYaml: { type: String, required: false },
        mergedYaml: { type: String, required: false },
      },
      required: false,
      _id: false,
    },
    closed: {
      type: {
        byId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        at: { type: Date, required: true },
        kind: { type: String, enum: ['withdrawn', 'rejected'], required: true },
        reason: { type: String, required: false },
      },
      required: false,
      _id: false,
    },
    // Spaces out the notifications of updates made from a fork.
    lastNotifiedAt: { type: Date, required: false },
  },
  { timestamps: true }
);

// The same indexes as migration 20261111120000-create-pricing-pull-requests.
pricingPullRequestSchema.index({ pricingId: 1, number: 1 }, { unique: true });
pricingPullRequestSchema.index({ pricingId: 1, status: 1, updatedAt: -1 });
pricingPullRequestSchema.index({ authorId: 1, createdAt: -1 });
// At most one open pull request from each fork to each pricing. The rule lives
// in the service; this index is defence in depth.
pricingPullRequestSchema.index(
  { pricingId: 1, 'origin.pricingId': 1 },
  { unique: true, partialFilterExpression: { status: 'open', 'origin.pricingId': { $exists: true } } }
);

const pricingPullRequestModel = mongoose.model('PricingPullRequest', pricingPullRequestSchema, 'pricingPullRequests');

export default pricingPullRequestModel;
