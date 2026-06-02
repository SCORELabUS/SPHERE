import container from '../config/container';
import NotificationRepository from '../repositories/mongoose/NotificationRepository';
import sseManager from './SseManager';

class NotificationService {
  private notificationRepository: NotificationRepository;

  constructor() {
    this.notificationRepository = container.resolve('notificationRepository');
  }

  async getNotifications(userId: string, options?: { unreadOnly?: boolean; offset?: number; limit?: number }) {
    return this.notificationRepository.findByUserId(userId, options);
  }

  async getUnreadCount(userId: string) {
    return this.notificationRepository.countUnread(userId);
  }

  async createNotification(data: {
    userId: string;
    kind: string;
    title: string;
    message: string;
    data?: Record<string, any>;
  }) {
    const notification = await this.notificationRepository.create({
      _userId: data.userId,
      kind: data.kind,
      title: data.title,
      message: data.message,
      data: data.data,
    });

    // Send real-time event to connected user
    sseManager.sendToUser(data.userId, 'notification', {
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      read: notification.read,
      createdAt: notification.createdAt,
    });

    return notification;
  }

  async markAsRead(notificationId: string, userId: string) {
    const result = await this.notificationRepository.markAsRead(notificationId, userId);
    if (!result) {
      throw new Error('NOT FOUND: Notification not found');
    }
    return { success: true };
  }

  async markAllAsRead(userId: string) {
    const count = await this.notificationRepository.markAllAsRead(userId);
    return { updated: count };
  }

  async deleteNotification(notificationId: string) {
    const result = await this.notificationRepository.destroy(notificationId);
    if (!result) {
      throw new Error('NOT FOUND: Notification not found');
    }
    return { success: true };
  }
}

export default NotificationService;
