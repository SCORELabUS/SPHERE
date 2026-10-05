import mongoose, { Schema } from 'mongoose';
import PricingIdentity from './PricingIdentityMongoose';
import { generateSlug } from '../../../utils/slug-manager';

const pricingSchema = new Schema(
  {
    pricingId: { type: Schema.Types.ObjectId, ref: 'PricingIdentity', immutable: true },
    name: { type: String, required: true },
    slug: { type: String, required: false },
    _collectionId: { type: String, ref: 'PricingCollection', required: false },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    version: { type: String, required: true },
    createdAt: { type: Date, required: true },
    url: { type: String, required: false },
    currency: { type: String, required: true },
    yaml: { type: String, required: true },
    private: { type: Boolean, required: true, default: false },
    // Identifies which pricing this one was forked from, alongside organization/collection/name.
    // Used to match a re-fork of the same origin to the fork already living in the target org,
    // instead of creating a duplicate pricing every time the origin gets a new version.
    forkedFrom: {
      type: {
        pricingId: { type: Schema.Types.ObjectId, ref: 'PricingIdentity', required: true },
        organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
        organizationName: { type: String, required: true },
        organizationDisplayName: { type: String, required: true },
        collectionId: { type: String, ref: 'PricingCollection', required: false },
        collectionName: { type: String, required: false },
        collectionSlug: { type: String, required: false },
        slug: { type: String, required: true },
        name: { type: String, required: true },
        version: { type: String, required: true },
      },
      required: false,
    },
    analytics: {
      numberOfFeatures: { type: Number, required: false },
      numberOfInformationFeatures: { type: Number, required: false },
      numberOfIntegrationFeatures: { type: Number, required: false },
      numberOfIntegrationApiFeatures: { type: Number, required: false },
      numberOfIntegrationExtensionFeatures: { type: Number, required: false },
      numberOfIntegrationIdentityProviderFeatures: { type: Number, required: false },
      numberOfIntegrationWebSaaSFeatures: { type: Number, required: false },
      numberOfIntegrationMarketplaceFeatures: { type: Number, required: false },
      numberOfIntegrationExternalDeviceFeatures: { type: Number, required: false },
      numberOfDomainFeatures: { type: Number, required: false },
      numberOfAutomationFeatures: { type: Number, required: false },
      numberOfBotAutomationFeatures: { type: Number, required: false },
      numberOfFilteringAutomationFeatures: { type: Number, required: false },
      numberOfTrackingAutomationFeatures: { type: Number, required: false },
      numberOfTaskAutomationFeatures: { type: Number, required: false },
      numberOfManagementFeatures: { type: Number, required: false },
      numberOfGuaranteeFeatures: { type: Number, required: false },
      numberOfSupportFeatures: { type: Number, required: false },
      numberOfPaymentFeatures: { type: Number, required: false },
      numberOfUsageLimits: { type: Number, required: false },
      numberOfRenewableUsageLimits: { type: Number, required: false },
      numberOfNonRenewableUsageLimits: { type: Number, required: false },
      numberOfResponseDrivenUsageLimits: { type: Number, required: false },
      numberOfTimeDrivenUsageLimits: { type: Number, required: false },
      numberOfPlans: { type: Number, required: false },
      numberOfFreePlans: { type: Number, required: false },
      numberOfPaidPlans: { type: Number, required: false },
      numberOfAddOns: { type: Number, required: false },
      numberOfReplacementAddons: { type: Number, required: false },
      numberOfExtensionAddons: { type: Number, required: false },
      configurationSpaceSize: { type: Number, required: false },
      minSubscriptionPrice: { type: Number, required: false },
      maxSubscriptionPrice: { type: Number, required: false },
    },
  },
  {
    toObject: {
      getters: true,
      virtuals: true,
    },
  }
);

pricingSchema.pre('save', function (next) {
  if (!this.slug && this.name) {
    this.slug = generateSlug(this.name);
  }
  next();
});

pricingSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as any;
  if (update?.name && !update?.slug) {
    update.slug = generateSlug(update.name);
  }
  if (update?.$set?.name && !update?.$set?.slug) {
    update.$set.slug = generateSlug(update.$set.name);
  }
  next();
});

pricingSchema.virtual('collection', {
  ref: 'PricingCollection',
  localField: '_collectionId',
  foreignField: '_id',
  justOne: true,
});

pricingSchema.virtual('organization', {
  ref: 'Organization',
  localField: '_organizationId',
  foreignField: '_id',
  justOne: true,
});

// Adding unique index for [name, _organizationId, version, _collectionId]
pricingSchema.index({ name: 1, _organizationId: 1, version: 1, _collectionId: 1 }, { unique: true });

// Unique slug per organization (includes version and collection to allow multiple versions of the same pricing)
pricingSchema.index({ slug: 1, _organizationId: 1, version: 1, _collectionId: 1 }, { unique: true });

pricingSchema.index({ pricingId: 1, version: 1 }, { unique: true, partialFilterExpression: { pricingId: { $type: 'objectId' } } });

async function refreshIdentities(ids: any[], pricingModel: any) {
  const identityIds = ids.filter(Boolean);
  if (!identityIds.length) return;

  // Hooks can run from ts-migrate's dedicated Connection rather than the
  // application's default mongoose connection. Always resolve both models
  // from the connection that executed the pricing operation; otherwise a
  // migration would query the disconnected global model until buffering
  // times out.
  const connection = pricingModel.db;
  const Model = connection.models.Pricing || connection.model('Pricing', pricingSchema, 'pricings');
  const Identity = connection.models.PricingIdentity ||
    connection.model('PricingIdentity', PricingIdentity.schema, 'pricingIdentities');
  for (const id of identityIds) {
    const current: any = await Model.findOne({ pricingId: id }).lean();
    await Identity.updateOne({ _id: id }, current ? { $set: {
      name: current.name, slug: current.slug, _organizationId: current._organizationId,
      _collectionId: current._collectionId ?? null, deleted: false,
    } } : { $set: { deleted: true } });
  }
}
pricingSchema.post('save', async function(doc) { await refreshIdentities([doc.pricingId], doc.constructor); });
for (const operation of ['updateMany', 'deleteMany', 'deleteOne', 'findOneAndDelete'] as const) {
  pricingSchema.pre(operation, async function(this: any) {
    const rows = await this.model.find(this.getFilter()).select('pricingId').lean();
    this.identityIds = rows.map((row: any) => row.pricingId);
  });
  pricingSchema.post(operation, async function(this: any) { await refreshIdentities(this.identityIds ?? [], this.model); });
}

const pricingModel = mongoose.model('Pricing', pricingSchema, 'pricings');

export default pricingModel;
