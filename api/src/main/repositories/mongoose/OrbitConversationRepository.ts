import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import OrbitConversationMongoose from './models/OrbitConversationMongoose';
import {
  LeanOrbitConversation,
  OrbitAttachment,
  OrbitStoredMessage,
} from '../../types/models/Orbit';

class OrbitConversationRepository extends RepositoryBase {
  async create(userId: string, title: string): Promise<LeanOrbitConversation> {
    const conversation = await new OrbitConversationMongoose({
      _userId: new mongoose.Types.ObjectId(userId),
      title,
    }).save();
    return conversation.toObject() as unknown as LeanOrbitConversation;
  }

  /** A conversation, only when it belongs to the given user. */
  async findByIdForUser(id: string, userId: string): Promise<LeanOrbitConversation | null> {
    if (!this.isValidObjectId(id)) return null;
    const conversation = await OrbitConversationMongoose.findOne({
      _id: id,
      _userId: new mongoose.Types.ObjectId(userId),
    });
    return conversation ? (conversation.toObject() as unknown as LeanOrbitConversation) : null;
  }

  /** The user's conversations, newest first, without their messages. */
  async findByUser(
    userId: string,
    limit: number
  ): Promise<Array<{ id: string; title: string; createdAt: Date; updatedAt: Date }>> {
    const conversations = await OrbitConversationMongoose.find({
      _userId: new mongoose.Types.ObjectId(userId),
    })
      .select('title createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    return conversations.map((conversation: any) => ({
      id: conversation._id.toString(),
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }));
  }

  async appendMessages(
    id: string,
    messages: OrbitStoredMessage[],
    title?: string
  ): Promise<void> {
    const update: Record<string, any> = { $push: { messages: { $each: messages } } };
    if (title) update.$set = { title };
    await OrbitConversationMongoose.updateOne({ _id: id }, update);
  }

  async addAttachment(id: string, attachment: OrbitAttachment): Promise<void> {
    await OrbitConversationMongoose.updateOne({ _id: id }, { $push: { attachments: attachment } });
  }
}

export default OrbitConversationRepository;
