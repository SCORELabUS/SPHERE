import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import OrbitAuditLogMongoose from './models/OrbitAuditLogMongoose';
import { OrbitAuditEntry } from '../../types/models/Orbit';

class OrbitAuditLogRepository extends RepositoryBase {
  async create(entry: OrbitAuditEntry): Promise<void> {
    await new OrbitAuditLogMongoose({
      _userId: new mongoose.Types.ObjectId(entry.userId),
      _planId: new mongoose.Types.ObjectId(entry.planId),
      _conversationId: new mongoose.Types.ObjectId(entry.conversationId),
      stepId: entry.stepId,
      action: entry.action,
      params: entry.params,
      outcome: entry.outcome,
      result: entry.result ?? null,
      error: entry.error ?? null,
    }).save();
  }

  /** How many times a user's plans successfully ran an action since a moment. */
  async countSuccessfulSince(userId: string, action: string, since: Date): Promise<number> {
    return OrbitAuditLogMongoose.countDocuments({
      _userId: new mongoose.Types.ObjectId(userId),
      action,
      outcome: 'SUCCESS',
      createdAt: { $gte: since },
    });
  }

  async findByPlan(planId: string): Promise<any[]> {
    return OrbitAuditLogMongoose.find({ _planId: new mongoose.Types.ObjectId(planId) })
      .sort({ createdAt: 1 })
      .lean();
  }
}

export default OrbitAuditLogRepository;
