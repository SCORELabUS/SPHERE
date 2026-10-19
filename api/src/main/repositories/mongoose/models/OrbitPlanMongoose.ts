import mongoose, { Schema } from 'mongoose';

// A list of changes ORBIT proposed. It is kept until the user confirms or drops
// it, and then records how each step went.
const orbitPlanStepSchema = new Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true },
    operation: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'DONE', 'FAILED', 'SKIPPED'],
      default: 'PENDING',
    },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { _id: false }
);

const orbitPlanSchema = new Schema(
  {
    _userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    _conversationId: { type: Schema.Types.ObjectId, ref: 'OrbitConversation', required: true },
    summary: { type: String, required: true },
    source: { type: String, required: true, enum: ['chat', 'file', 'mcp'], default: 'chat' },
    status: {
      type: String,
      required: true,
      enum: ['PENDING', 'EXECUTING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'SUPERSEDED'],
      default: 'PENDING',
    },
    steps: { type: [orbitPlanStepSchema], default: [] },
    warnings: { type: [String], default: [] },
    ignoredRows: {
      type: [new Schema({ row: Number, reason: String }, { _id: false })],
      default: [],
    },
    // Text the user must type to confirm a plan that is hard to undo.
    confirmationPhrase: { type: String, default: null },
    confirmedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toObject: {
      getters: true,
      virtuals: true,
      versionKey: false,
      transform: function (_, resultObject) {
        (resultObject as any).userId = resultObject._userId?.toString();
        (resultObject as any).conversationId = resultObject._conversationId?.toString();
        delete (resultObject as any)._id;
        delete (resultObject as any)._userId;
        delete (resultObject as any)._conversationId;
        return resultObject;
      },
    },
  }
);

orbitPlanSchema.index({ _conversationId: 1, createdAt: 1 });
orbitPlanSchema.index({ _userId: 1, status: 1 });

const orbitPlanModel = mongoose.model('OrbitPlan', orbitPlanSchema, 'orbitPlans');

export default orbitPlanModel;
