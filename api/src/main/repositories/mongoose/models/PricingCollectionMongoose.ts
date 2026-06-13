import mongoose, { Schema } from 'mongoose';

const ParameterEvolutionSchema = new Schema(
  {
    dates: { type: [Date], default: [] },
    values: { type: [Number], default: [] },
  },
  { _id: false }
);

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const pricingCollectionSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    description: { type: String, required: false },
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: false },
    private: { type: Boolean, required: true, default: false },
    analytics: {
      evolutionOfPlans: { type: ParameterEvolutionSchema, required: false },
      evolutionOfAddOns: { type: ParameterEvolutionSchema, required: false },
      evolutionOfFeatures: { type: ParameterEvolutionSchema, required: false },
      evolutionOfConfigurationSpaceSize: { type: ParameterEvolutionSchema, required: false },
    },
  },
  {
    toObject: {
      virtuals: true,
      transform: function (doc, resultObject) {
        delete (resultObject as any)._id;
        delete (resultObject as any).__v;
        delete (resultObject as any)._organizationId;
        delete (resultObject as any).organization?._id;
        return resultObject;
      },
    },
  }
);

pricingCollectionSchema.virtual('organization', {
  ref: 'Organization',
  localField: '_organizationId',
  foreignField: '_id',
  justOne: true,
});

pricingCollectionSchema.pre('save', function (next) {
  if (!this.slug && this.name) {
    this.slug = generateSlug(this.name);
  }
  next();
});

pricingCollectionSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() as any;
  if (update?.name && !update?.slug) {
    update.slug = generateSlug(update.name);
  }
  if (update?.$set?.name && !update?.$set?.slug) {
    update.$set.slug = generateSlug(update.$set.name);
  }
  next();
});

// Adding unique index for [name, _organizationId]
pricingCollectionSchema.index({ name: 1, _organizationId: 1 }, { unique: true });

// Adding unique index for [slug, _organizationId]
pricingCollectionSchema.index({ slug: 1, _organizationId: 1 }, { unique: true, sparse: true });

const pricingCollectionModel = mongoose.model(
  'PricingCollection',
  pricingCollectionSchema,
  'pricingCollections'
);

export { generateSlug };
export default pricingCollectionModel;
