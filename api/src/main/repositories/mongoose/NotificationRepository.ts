import RepositoryBase from '../RepositoryBase';
import NotificationMongoose from './models/NotificationMongoose';

class NotificationRepository extends RepositoryBase {
  async findByUserId(
    userId: string,
    options?: { unreadOnly?: boolean; offset?: number; limit?: number }
  ): Promise<any[]> {
    const filter: any = { _userId: userId };
    if (options?.unreadOnly) filter.read = false;

    const query = NotificationMongoose.find(filter).sort({ createdAt: -1 });
    if (options?.offset) query.skip(options.offset);
    if (options?.limit) query.limit(options.limit);

    const notifications = await query.exec();
    return notifications.map((n) => n.toObject());
  }

  async countUnread(userId: string): Promise<number> {
    return NotificationMongoose.countDocuments({ _userId: userId, read: false });
  }

  async create(data: {
    _userId: string;
    kind: string;
    title: string;
    message: string;
    data?: Record<string, any>;
  }): Promise<any> {
    const notification = await new NotificationMongoose(data).save();
    return notification.toObject();
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const result = await NotificationMongoose.updateOne(
      { _id: id, _userId: userId },
      { read: true }
    );
    return result.modifiedCount === 1;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await NotificationMongoose.updateMany(
      { _userId: userId, read: false },
      { read: true }
    );
    return result.modifiedCount;
  }

  async destroy(id: string): Promise<boolean> {
    const result = await NotificationMongoose.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }
}

export default NotificationRepository;
