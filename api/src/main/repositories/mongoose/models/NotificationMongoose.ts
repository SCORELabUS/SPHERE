import mongoose, { Document, Schema } from 'mongoose';

export interface NotificationDocument extends Document {
  id: string;
  _userId: mongoose.Types.ObjectId;
  kind: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema(
  {
    _userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      required: true,
      enum: ['OrganizationInvitation', 'System', 'CollectionShared', 'PricingUpdated'],
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toObject: {
      getters: true,
      virtuals: true,
      versionKey: false,
      transform: function (_, resultObject) {
        delete (resultObject as any)._id;
        delete (resultObject as any)._userId;
        return resultObject;
      },
    },
  }
);

notificationSchema.index({ _userId: 1, read: 1 });
notificationSchema.index({ _userId: 1, createdAt: -1 });

const notificationModel = mongoose.model<NotificationDocument>('Notification', notificationSchema, 'notifications');

export default notificationModel;
