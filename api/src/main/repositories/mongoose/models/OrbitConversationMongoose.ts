import mongoose, { Schema } from 'mongoose';

// One ORBIT chat. Messages are kept in the shape the model is sent them in, tool
// traffic included, so a conversation can be picked up where it was left.
const orbitMessageSchema = new Schema(
  {
    id: { type: String, required: true },
    role: { type: String, required: true, enum: ['user', 'assistant', 'tool'] },
    content: { type: String, default: null },
    toolCalls: { type: Schema.Types.Mixed, default: undefined },
    toolCallId: { type: String, default: null },
    planId: { type: String, default: null },
    attachmentId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Files are stored as the text they were sent as: the importer reads them again
// whenever the user asks for the interpretation to be redone.
const orbitAttachmentSchema = new Schema(
  {
    id: { type: String, required: true },
    filename: { type: String, required: true },
    size: { type: Number, required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const orbitConversationSchema = new Schema(
  {
    _userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, default: 'New conversation' },
    messages: { type: [orbitMessageSchema], default: [] },
    attachments: { type: [orbitAttachmentSchema], default: [] },
  },
  {
    timestamps: true,
    toObject: {
      getters: true,
      virtuals: true,
      versionKey: false,
      transform: function (_, resultObject) {
        (resultObject as any).userId = resultObject._userId?.toString();
        delete (resultObject as any)._id;
        delete (resultObject as any)._userId;
        return resultObject;
      },
    },
  }
);

orbitConversationSchema.index({ _userId: 1, updatedAt: -1 });

const orbitConversationModel = mongoose.model(
  'OrbitConversation',
  orbitConversationSchema,
  'orbitConversations'
);

export default orbitConversationModel;
