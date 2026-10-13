import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import OrbitPlanMongoose from './models/OrbitPlanMongoose';
import {
  LeanOrbitPlan,
  OrbitIgnoredRow,
  OrbitPlanSource,
  OrbitPlanStatus,
  OrbitPlanStep,
  OrbitStepStatus,
} from '../../types/models/Orbit';

class OrbitPlanRepository extends RepositoryBase {
  async create(data: {
    userId: string;
    conversationId: string;
    summary: string;
    source: OrbitPlanSource;
    steps: OrbitPlanStep[];
    warnings: string[];
    ignoredRows: OrbitIgnoredRow[];
  }): Promise<LeanOrbitPlan> {
    const plan = await new OrbitPlanMongoose({
      _userId: new mongoose.Types.ObjectId(data.userId),
      _conversationId: new mongoose.Types.ObjectId(data.conversationId),
      summary: data.summary,
      source: data.source,
      steps: data.steps,
      warnings: data.warnings,
      ignoredRows: data.ignoredRows,
    }).save();
    return plan.toObject() as unknown as LeanOrbitPlan;
  }

  /** A plan, only when it belongs to the given user. */
  async findByIdForUser(id: string, userId: string): Promise<LeanOrbitPlan | null> {
    if (!this.isValidObjectId(id)) return null;
    const plan = await OrbitPlanMongoose.findOne({
      _id: id,
      _userId: new mongoose.Types.ObjectId(userId),
    });
    return plan ? (plan.toObject() as unknown as LeanOrbitPlan) : null;
  }

  async findById(id: string): Promise<LeanOrbitPlan | null> {
    if (!this.isValidObjectId(id)) return null;
    const plan = await OrbitPlanMongoose.findById(id);
    return plan ? (plan.toObject() as unknown as LeanOrbitPlan) : null;
  }

  async findByConversation(conversationId: string): Promise<LeanOrbitPlan[]> {
    const plans = await OrbitPlanMongoose.find({
      _conversationId: new mongoose.Types.ObjectId(conversationId),
    }).sort({ createdAt: 1 });
    return plans.map(plan => plan.toObject() as unknown as LeanOrbitPlan);
  }

  /** A new proposal replaces whatever the conversation still had waiting. */
  async supersedePending(conversationId: string): Promise<void> {
    await OrbitPlanMongoose.updateMany(
      { _conversationId: new mongoose.Types.ObjectId(conversationId), status: 'PENDING' },
      { status: 'SUPERSEDED' }
    );
  }

  /**
   * Moves a pending plan to EXECUTING in a single write, so two confirmations
   * arriving together cannot both run it: only one of them finds it pending.
   */
  async claimForExecution(id: string, userId: string): Promise<LeanOrbitPlan | null> {
    if (!this.isValidObjectId(id)) return null;
    const plan = await OrbitPlanMongoose.findOneAndUpdate(
      { _id: id, _userId: new mongoose.Types.ObjectId(userId), status: 'PENDING' },
      { status: 'EXECUTING', confirmedAt: new Date() },
      { new: true }
    );
    return plan ? (plan.toObject() as unknown as LeanOrbitPlan) : null;
  }

  async cancel(id: string, userId: string): Promise<LeanOrbitPlan | null> {
    if (!this.isValidObjectId(id)) return null;
    const plan = await OrbitPlanMongoose.findOneAndUpdate(
      { _id: id, _userId: new mongoose.Types.ObjectId(userId), status: 'PENDING' },
      { status: 'CANCELLED' },
      { new: true }
    );
    return plan ? (plan.toObject() as unknown as LeanOrbitPlan) : null;
  }

  async updateStep(
    id: string,
    stepId: string,
    data: { status: OrbitStepStatus; result?: Record<string, any> | null; error?: string | null }
  ): Promise<void> {
    await OrbitPlanMongoose.updateOne(
      { _id: id, 'steps.id': stepId },
      {
        $set: {
          'steps.$.status': data.status,
          'steps.$.result': data.result ?? null,
          'steps.$.error': data.error ?? null,
        },
      }
    );
  }

  async finish(id: string, status: OrbitPlanStatus): Promise<LeanOrbitPlan | null> {
    const plan = await OrbitPlanMongoose.findByIdAndUpdate(
      id,
      { status, completedAt: new Date() },
      { new: true }
    );
    return plan ? (plan.toObject() as unknown as LeanOrbitPlan) : null;
  }
}

export default OrbitPlanRepository;
