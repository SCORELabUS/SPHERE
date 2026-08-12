import container from '../config/container';
import UserService from '../services/UserService';
import UserSettingsService from '../services/UserSettingsService';
import ApiKeyService from '../services/ApiKeyService';
import { LeanUser, UserFilters } from '../types/models/User';
import { handleError } from '../utils/users/helpers';
import multer from 'multer';
import EmailVerificationService from '../services/EmailVerificationService';

const settingsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG and WebP images are allowed'));
  },
});

class UserController {
  private userService: UserService;
  private userSettingsService: UserSettingsService;
  private apiKeyService: ApiKeyService;
  private emailVerificationService: EmailVerificationService;
  public settingsUploadMiddleware: any;

  constructor() {
    this.userService = container.resolve('userService');
    this.userSettingsService = container.resolve('userSettingsService');
    this.apiKeyService = container.resolve('apiKeyService');
    this.emailVerificationService = container.resolve('emailVerificationService');
    this.index = this.index.bind(this);
    this.show = this.show.bind(this);
    this.getCurrentUser = this.getCurrentUser.bind(this);
    this.login = this.login.bind(this);
    this.register = this.register.bind(this);
    this.verifyEmail = this.verifyEmail.bind(this);
    this.resendEmailVerification = this.resendEmailVerification.bind(this);
    this.destroy = this.destroy.bind(this);
    this.update = this.update.bind(this);
    this.updateToken = this.updateToken.bind(this);
    this.getSettings = this.getSettings.bind(this);
    this.updateAccountSettings = this.updateAccountSettings.bind(this);
    this.updateProfile = this.updateProfile.bind(this);
    this.updateSocialLinks = this.updateSocialLinks.bind(this);
    this.updateNotificationPrefs = this.updateNotificationPrefs.bind(this);
    this.uploadAvatar = this.uploadAvatar.bind(this);
    this.removeAvatar = this.removeAvatar.bind(this);
    this.updateAvatarColors = this.updateAvatarColors.bind(this);
    this.getApiKeys = this.getApiKeys.bind(this);
    this.createApiKey = this.createApiKey.bind(this);
    this.revokeApiKey = this.revokeApiKey.bind(this);
    this.deleteApiKey = this.deleteApiKey.bind(this);
    this.settingsUploadMiddleware = settingsUpload.single('avatar');
  }

  async index(req: any, res: any) {
    try {
      const queryParamas = req.query;
      const q = queryParamas.q as string | undefined;

      // Allow USER role when searching with q (minimum 4 characters)
      if (req.user.role !== 'ADMIN') {
        if (!q || q.length < 4) {
          throw new Error('PERMISSION ERROR: Only ADMIN users can access the full list of users.');
        }
      }

      const users = await this.userService.index(queryParamas, req.user.role);
      res.json(users);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async show(req: any, res: any) {
    try {
      const targetUsername = req.params.username;
      const user = await this.userService.show(targetUsername);

      if (req.user.username === targetUsername || req.user.role === "ADMIN") {
        return res.json(user);
      } else {
        const propertiesToBeRemoved = [
          'password',
          'createdAt',
          'updatedAt',
          'token',
          'tokenExpiration',
          'phone',
          'role',
          'email',
          'address',
          'postalCode'
        ];

        const userObject = Object.assign({}, user);
        propertiesToBeRemoved.forEach(property => {
          delete (userObject as Record<string, any>)[property];
        });

        res.json(userObject);
      }
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async getCurrentUser(req: any, res: any) {
    try {
      const userSession = req.user;
      if (!userSession) {
        throw new Error('UNAUTHORIZED: No user session found');
      }

      res.json(userSession);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async register(req: any, res: any) {
    try {
      const result = await this.userService.register(req.body, req.user);

      res.status(201).json({
        user: result.registeredUser,
        emailVerificationRequired: result.emailVerificationRequired,
        emailSent: result.emailSent,
        message: result.emailSent
          ? 'Check your inbox to verify your email address.'
          : 'Your account was created, but the verification email could not be sent. Please request another email.',
      });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async verifyEmail(req: any, res: any) {
    try {
      await this.emailVerificationService.verify(req.body.token);
      res.json({ message: 'Email verified successfully. You can now sign in.' });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async resendEmailVerification(req: any, res: any) {
    try {
      await this.emailVerificationService.resend(req.body.loginField);
      res.status(202).json({
        message: 'If an unverified account matches those details, a verification email has been sent.',
      });
    } catch (err: any) {
      console.error('[Email verification] Resend failed:', err);
      res.status(202).json({
        message: 'If an unverified account matches those details, a verification email has been sent.',
      });
    }
  }

  async login(req: any, res: any) {
    try {
      const { token } = await this.userService.login(req.body.loginField, req.body.password);
      res.json({ token });
    } catch (err: any) {
      if (err.message.toLowerCase().includes('invalid credentials')) {
        return res.status(401).send({ error: err.message });
      } else {
        const { status, message } = handleError(err);
        res.status(status).send({ error: message });
      }
    }
  }

  async update(req: any, res: any) {
    try {
      const user = await this.userService.update(req.user, req.params.username, req.body);
      res.json(user);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateToken(req: any, res: any) {
    try {
      const token = await this.userService.updateToken(req.params.username, req.user);
      res.json(token);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async destroy(req: any, res: any) {
    try {
      const result = await this.userService.destroy(req.user, req.params.username);
      const message = result ? 'Successfully deleted.' : 'Could not delete user.';
      res.json({ message });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  // ============================================
  // Settings endpoints
  // ============================================

  private sanitizeSettingsResponse(user: any) {
    const { password, token, tokenExpiration, apiKeys, ...rest } = user;
    return rest;
  }

  private async resolveTargetUserId(req: any): Promise<string> {
    if (req.params.username) {
      if (req.user.role !== 'ADMIN') {
        throw new Error('PERMISSION ERROR: Only ADMIN users can access other users\' settings');
      }
      const targetUser = await this.userService.exists(req.params.username);
      if (!targetUser) throw new Error('NOT FOUND: User not found');
      return targetUser.id;
    }
    return req.user.id;
  }

  async getSettings(req: any, res: any) {
    try {
      const targetUserId = await this.resolveTargetUserId(req);
      const settings = await this.userSettingsService.getSettings(targetUserId);
      res.json(settings);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateAccountSettings(req: any, res: any) {
    try {
      const targetUserId = await this.resolveTargetUserId(req);
      const { email, firstName, lastName, phone } = req.body;
      const settings = await this.userSettingsService.updateAccount(targetUserId, { email, firstName, lastName, phone });
      res.json(settings);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateProfile(req: any, res: any) {
    try {
      const targetUserId = await this.resolveTargetUserId(req);
      const { displayName, bio, city, country, dateOfBirth } = req.body;
      const settings = await this.userSettingsService.updateProfile(targetUserId, { displayName, bio, city, country, dateOfBirth });
      res.json(settings);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateSocialLinks(req: any, res: any) {
    try {
      const targetUserId = await this.resolveTargetUserId(req);
      const { linkedin, instagram, facebook, x } = req.body;
      const settings = await this.userSettingsService.updateSocialLinks(targetUserId, { linkedin, instagram, facebook, x });
      res.json(settings);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateNotificationPrefs(req: any, res: any) {
    try {
      const targetUserId = await this.resolveTargetUserId(req);
      const settings = await this.userSettingsService.updateNotificationPrefs(targetUserId, req.body);
      res.json(settings);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async uploadAvatar(req: any, res: any) {
    try {
      if (!req.file) {
        return res.status(400).send({ error: 'No file uploaded' });
      }

      const targetUserId = await this.resolveTargetUserId(req);
      const fs = await import('fs');
      const path = await import('path');

      const ext = req.file.originalname.split('.').pop() || 'webp';
      const filename = `${targetUserId}-${Date.now()}.${ext}`;
      const folder = (process.env.SERVER_STATICS_FOLDER || 'public/') + (process.env.AVATARS_FOLDER || 'static/avatars/users');

      fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const avatarPath = `${process.env.AVATARS_FOLDER || 'static/avatars/users/uploaded'}/${filename}`;
      const updated = await this.userSettingsService.updateAvatar(targetUserId, {
        avatarPath,
        avatarBgColor: req.body.avatarBgColor || '#fa520f',
        avatarFgColor: req.body.avatarFgColor || '#ffffff',
      });

      res.json(this.sanitizeSettingsResponse(updated));
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async removeAvatar(req: any, res: any) {
    try {
      const targetUserId = await this.resolveTargetUserId(req);
      const settings = await this.userSettingsService.removeAvatar(targetUserId);
      res.json(settings);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateAvatarColors(req: any, res: any) {
    try {
      const targetUserId = await this.resolveTargetUserId(req);
      const { avatarPath, avatarBgColor, avatarFgColor } = req.body;
      const settings = await this.userSettingsService.updateAvatar(targetUserId, { avatarPath, avatarBgColor, avatarFgColor });
      res.json(settings);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  // ============================================
  // API Keys endpoints
  // ============================================

  async getApiKeys(req: any, res: any) {
    try {
      const apiKeys = await this.apiKeyService.getApiKeys(req.user, req.params.username);
      res.json(apiKeys);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async createApiKey(req: any, res: any) {
    try {
      const { apiKey, plainKey } = await this.apiKeyService.createApiKey(
        req.user,
        req.params.username,
        req.body
      );
      res.status(201).json({
        apiKey: { ...apiKey, id: apiKey._id },
        plainKey,
      });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async revokeApiKey(req: any, res: any) {
    try {
      await this.apiKeyService.revokeApiKey(req.user, req.params.username, req.params.keyId);
      res.json({ message: 'API key revoked' });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async deleteApiKey(req: any, res: any) {
    try {
      await this.apiKeyService.deleteApiKey(req.user, req.params.username, req.params.keyId);
      res.status(204).send();
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }
}

export default UserController;
