import mongoose, { Schema } from 'mongoose';
import { OrgRole, ROLE_WEIGHT } from '../../../types/models/Organization';

const organizationMembershipSchema = new Schema(
  {
    _userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      set: (v: string | mongoose.Types.ObjectId) => new mongoose.Types.ObjectId(v),
      get: (v: mongoose.Types.ObjectId | null) => v?.toString(),
    },
    _organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      set: (v: string | mongoose.Types.ObjectId) => new mongoose.Types.ObjectId(v),
      get: (v: mongoose.Types.ObjectId | null) => v?.toString(),
    },
    _roleWeight: { type: Number, required: true, select: false },
    role: {
      type: String,
      required: true,
      enum: ['OWNER', 'ADMIN', 'MEMBER'],
      set: function (v: OrgRole) {
        this._roleWeight = ROLE_WEIGHT[v as keyof typeof ROLE_WEIGHT] ?? 0;
        return v;
      },
    },
    joinedAt: { type: Date, required: true, default: Date.now },
  },
  {
    timestamps: true,
    getters: true,
    toObject: {
      virtuals: true,
      transform: function (doc, resultObject) {
        delete (resultObject as any)._id;
        delete (resultObject as any).__v;
        return resultObject;
      },
    },
  }
);

organizationMembershipSchema.index({ _userId: 1, _organizationId: 1 }, { unique: true });
organizationMembershipSchema.index({ _organizationId: 1 });
organizationMembershipSchema.index({ _userId: 1 });

const organizationMembershipModel = mongoose.model(
  'OrganizationMembership',
  organizationMembershipSchema,
  'organizationMemberships'
);

export default organizationMembershipModel;
