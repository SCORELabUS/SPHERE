import mongoose, { Schema } from 'mongoose';
import { generateSlug } from '../../../utils/slug-manager';

const pricingSchema = new Schema(
  {
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

const pricingModel = mongoose.model('Pricing', pricingSchema, 'pricings');

export default pricingModel;
