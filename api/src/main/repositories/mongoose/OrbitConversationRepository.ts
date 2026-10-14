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

  /**
   * How much a conversation takes in the database: the whole document, which
   * MongoDB caps at 16 MB, and the part of it that is attached files.
   */
  async storageUsage(id: string): Promise<{ totalBytes: number; attachmentBytes: number }> {
    const [usage] = await OrbitConversationMongoose.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      {
        $project: {
          totalBytes: { $bsonSize: '$$ROOT' },
          attachmentBytes: {
            $sum: {
              $map: { input: { $ifNull: ['$attachments', []] }, as: 'file', in: { $strLenBytes: { $ifNull: ['$$file.content', ''] } } },
            },
          },
        },
      },
    ]);
    return { totalBytes: usage?.totalBytes ?? 0, attachmentBytes: usage?.attachmentBytes ?? 0 };
  }

  async delete(id: string): Promise<void> {
    await OrbitConversationMongoose.deleteOne({ _id: id });
  }

  /** Takes back the messages of a turn that came to nothing, and the file it brought. */
  async removeTurn(id: string, messageIds: string[], attachmentId: string | null): Promise<void> {
    const pull: Record<string, any> = { messages: { id: { $in: messageIds } } };
    if (attachmentId) pull.attachments = { id: attachmentId };
    await OrbitConversationMongoose.updateOne({ _id: id }, { $pull: pull });
  }

  async addAttachment(id: string, attachment: OrbitAttachment): Promise<void> {
    await OrbitConversationMongoose.updateOne({ _id: id }, { $push: { attachments: attachment } });
  }
}

export default OrbitConversationRepository;
