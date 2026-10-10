import container from '../config/container';
import NotificationRepository from '../repositories/mongoose/NotificationRepository';
import UserRepository from '../repositories/mongoose/UserRepository';
import { LeanUser } from '../types/models/User';
import { EmailService } from './email/EmailService';
import sseManager from './SseManager';

class NotificationService {
  private notificationRepository: NotificationRepository;
  private userRepository: UserRepository;
  private emailService: EmailService;

  constructor() {
    this.notificationRepository = container.resolve('notificationRepository');
    this.userRepository = container.resolve('userRepository');
    this.emailService = container.resolve('emailService');
  }

  // Missing preferences (older accounts, kinds added later) behave as "on", like the schema default.
  private resolveChannels(user: LeanUser, kind: string) {
    const prefs: unknown = user.settings?.notificationPrefs;
    const kindPrefs = (prefs instanceof Map ? prefs.get(kind) : (prefs as Record<string, any> | undefined)?.[kind]) as
      | { email?: boolean; inbox?: boolean }
      | undefined;
    return { inbox: kindPrefs?.inbox !== false, email: kindPrefs?.email !== false };
  }

  private async sendEmail(user: LeanUser, data: { title: string; message: string }) {
    try {
      const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
      await this.emailService.sendNotificationEmail({
        recipientEmail: user.email,
        recipientName: user.firstName,
        title: data.title,
        message: data.message,
        actionUrl: `${frontendUrl}/notifications`,
      });
    } catch (error) {
      console.error('[Notification email] Delivery failed:', error);
    }
  }

  async getNotifications(userId: string, options?: { unreadOnly?: boolean; offset?: number; limit?: number }) {
    return this.notificationRepository.findByUserId(userId, options);
  }

  async getUnreadCount(userId: string) {
    return this.notificationRepository.countUnread(userId);
  }

  /**
   * Delivers a notification through the channels the recipient enabled for its kind in their
   * profile settings: `inbox` stores it and pushes it in real time, `email` sends it by mail.
   * Returns the stored notification, or null when the in-app channel is off or the user is gone.
   */
  async createNotification(data: {
    userId: string;
    kind: string;
    title: string;
    message: string;
    data?: Record<string, any>;
  }) {
    const user = await this.userRepository.findById(data.userId);
    if (!user) return null;

    const channels = this.resolveChannels(user, data.kind);

    if (channels.email && user.email) {
      // Not awaited: a slow or failing mail provider must not delay or fail the action that triggered this.
      void this.sendEmail(user, data);
    }

    if (!channels.inbox) return null;

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
