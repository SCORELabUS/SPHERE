import { authenticateUserToken } from '../middlewares/AuthenticationMiddleware';
import container from '../config/container';
import NotificationService from '../services/NotificationService';
import sseManager from '../services/SseManager';
import { handleError, verifyJwtToken } from '../utils/users/helpers';
import UserRepository from '../repositories/mongoose/UserRepository';

class NotificationController {
  private notificationService: NotificationService;
  private userRepository: UserRepository;

  constructor() {
    this.notificationService = container.resolve('notificationService');
    this.userRepository = container.resolve('userRepository');
    this.getNotifications = this.getNotifications.bind(this);
    this.getUnreadCount = this.getUnreadCount.bind(this);
    this.markAsRead = this.markAsRead.bind(this);
    this.markAllAsRead = this.markAllAsRead.bind(this);
    this.deleteNotification = this.deleteNotification.bind(this);
    this.streamNotifications = this.streamNotifications.bind(this);
  }

  async streamNotifications(req: any, res: any) {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(401).json({ error: 'Token required for SSE connection' });
      }

      let expiration: number | undefined;
      try {
        await authenticateUserToken(req, token);
        expiration = (verifyJwtToken(token) as { exp?: number }).exp;
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      const user = req.user;

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({ userId: user.id })}\n\n`);

      // Register client
      sseManager.addClient(user.id, res);

      // Send initial unread count
      const unreadCount = await this.notificationService.getUnreadCount(user.id);
      res.write(`event: unread-count\ndata: ${JSON.stringify({ count: unreadCount })}\n\n`);

      // Handle client disconnect
      const expires = expiration ? setTimeout(() => res.end(), Math.max(0, expiration * 1000 - Date.now())) : undefined;
      req.on('close', () => {
        if (expires) clearTimeout(expires);
        sseManager.removeClient(user.id);
      });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async getNotifications(req: any, res: any) {
    try {
      const userId = req.user.id;
      const unreadOnly = req.query.unreadOnly === 'true';
      const offset = req.query.offset ? parseInt(req.query.offset) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit) : undefined;

      const notifications = await this.notificationService.getNotifications(userId, { unreadOnly, offset, limit });
      res.json(notifications);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async getUnreadCount(req: any, res: any) {
    try {
      const userId = req.user.id;
      const count = await this.notificationService.getUnreadCount(userId);
      res.json({ count });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async markAsRead(req: any, res: any) {
    try {
      const userId = req.user.id;
      const { notificationId } = req.params;
      const result = await this.notificationService.markAsRead(notificationId, userId);
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async markAllAsRead(req: any, res: any) {
    try {
      const userId = req.user.id;
      const result = await this.notificationService.markAllAsRead(userId);
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async deleteNotification(req: any, res: any) {
    try {
      const { notificationId } = req.params;
      const result = await this.notificationService.deleteNotification(notificationId);
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }
}

export default NotificationController;
