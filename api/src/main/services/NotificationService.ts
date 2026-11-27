import container from '../config/container';
import NotificationRepository from '../repositories/mongoose/NotificationRepository';
import UserRepository from '../repositories/mongoose/UserRepository';
import { LeanUser } from '../types/models/User';
import { EmailService } from './email/EmailService';
import sseManager from './SseManager';
import { canReadOrganization, scopeOrganizationIds } from '../policies/organizationVisibility';

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

  async getNotifications(userId: string, options?: { unreadOnly?: boolean; offset?: number; limit?: number }, credential?: any) {
    return this.redactHiddenPricings(userId, await this.notificationRepository.findByUserId(userId, options), credential);
  }

  /** Old notifications must stop revealing a pricing when access is removed later. */
  async redactHiddenPricings(userId: string, notifications: any[], credential?: any) {
    if (!notifications.some(notification => notification.kind === 'PricingUpdated' || notification.data?.organizationId)) return notifications;
    const user = await this.userRepository.findById(userId);
    const requester = user && credential?.apiKey ? { ...user, apiKey: credential.apiKey } : user;
    const service = container.resolve<any>('pricingService');
    return Promise.all(notifications.map(async notification => {
      try {
        const { organizationId, pricingSlug, version } = notification.data ?? {};
        if (organizationId && credential?.apiKey && !(await scopeOrganizationIds(requester, [String(organizationId)])).length) throw new Error('Unavailable');
        if (organizationId && notification.kind === 'System' && !await canReadOrganization(String(organizationId), requester)) throw new Error('Unavailable');
        if (notification.kind !== 'PricingUpdated') return notification;
        if (!requester || !organizationId || !pricingSlug || !version) throw new Error('Unavailable');
        const pricing = await service.show(pricingSlug, organizationId, requester);
        if (!pricing.versions.some((item: any) => String(item.version) === String(version))) throw new Error('Unavailable');
        return notification;
      } catch {
        return { ...notification, title: 'Unavailable notification', message: '', data: {} };
      }
    }));
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
