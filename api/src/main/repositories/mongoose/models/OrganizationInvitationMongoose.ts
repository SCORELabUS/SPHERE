import mongoose, { Schema } from 'mongoose';

const organizationInvitationSchema = new Schema(
  {
    _organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    code: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: false, default: null },
    maxUses: { type: Number, required: false, default: null },
    useCount: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: true,
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

const organizationInvitationModel = mongoose.model(
  'OrganizationInvitation',
  organizationInvitationSchema,
  'organizationInvitations'
);

export default organizationInvitationModel;
