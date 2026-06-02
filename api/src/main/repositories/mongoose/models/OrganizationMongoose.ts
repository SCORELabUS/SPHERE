import mongoose, { Schema } from 'mongoose';

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    description: { type: String, required: false, default: null },
    avatar: { type: String, required: false, default: `${process.env.ORG_AVATARS_FOLDER}/default-org.webp` },
    _parentId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: false,
      default: null,
      set: (v: string | mongoose.Types.ObjectId | null) => v ? new mongoose.Types.ObjectId(v) : v,
      get: (v: mongoose.Types.ObjectId | null) => v?.toString(),
    },
    ancestors: {
      type: [Schema.Types.ObjectId],
      ref: 'Organization',
      default: [],
      set: (v: (string | mongoose.Types.ObjectId)[]) => v?.map(id => new mongoose.Types.ObjectId(id)),
      get: (v: mongoose.Types.ObjectId[]) => v?.map(id => id.toString()),
    },
    isPersonal: { type: Boolean, required: true, default: false },
  },
  {
    timestamps: true,
    toObject: {
      getters: true,
      virtuals: true,
      versionKey: false,
      transform: function (doc, resultObject) {
        delete (resultObject as any)._id;
        delete (resultObject as any).__v;
        return resultObject;
      },
    },
  }
);

/**
 * Critical indexes for efficient querying of organizational hierarchies and membership checks
 */
organizationSchema.index(
  { name: 1, isPersonal: 1 },
  {
    unique: true,
    collation: {
      locale: 'en',
      strength: 2, // Case-insensitive, diacritic-sensitive
    },
    partialFilterExpression: {
      deletedAt: { $exists: false },
    },
  }
);

organizationSchema.index({ _parentId: 1 });
organizationSchema.index({ ancestors: 1 });

/**
 * Virtual: subOrganizations
 */
organizationSchema.virtual('subOrganizations', {
  ref: 'Organization',
  localField: '_id',
  foreignField: '_parentId',
});

const organizationModel = mongoose.model('Organization', organizationSchema, 'organizations');

export default organizationModel;
