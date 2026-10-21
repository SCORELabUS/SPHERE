import mongoose, { Schema } from 'mongoose';

// One line per action the ORBIT executor took (or skipped) on the user's behalf.
const orbitAuditLogSchema = new Schema(
  {
    _userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    _planId: { type: Schema.Types.ObjectId, ref: 'OrbitPlan', required: true },
    _conversationId: { type: Schema.Types.ObjectId, ref: 'OrbitConversation', required: true },
    stepId: { type: String, required: true },
    action: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    outcome: { type: String, required: true, enum: ['SUCCESS', 'FAILURE', 'SKIPPED'] },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

orbitAuditLogSchema.index({ _userId: 1, createdAt: -1 });
orbitAuditLogSchema.index({ _planId: 1 });

const orbitAuditLogModel = mongoose.model('OrbitAuditLog', orbitAuditLogSchema, 'orbitAuditLogs');

export default orbitAuditLogModel;
