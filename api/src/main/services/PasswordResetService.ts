import crypto from 'crypto';
import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import { EmailService } from './email/EmailService';
import { hashPassword } from '../utils/users/helpers';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

class PasswordResetService {
  private userRepository: UserRepository;
  private emailService: EmailService;

  constructor() {
    this.userRepository = container.resolve('userRepository');
    this.emailService = container.resolve('emailService');
  }

  async requestReset(loginField: string): Promise<void> {
    const normalized = loginField.trim().toLowerCase();
    if (!normalized) return;

    const user = normalized.includes('@')
      ? await this.userRepository.findByEmail(normalized, '+password +passwordResetSentAt')
      : await this.userRepository.findByUsername(normalized, '+password +passwordResetSentAt');

    // Silently ignore unknown accounts and SSO-only accounts (no local password) to avoid enumeration.
    if (!user || !user.password) return;

    const lastSentAt = user.passwordResetSentAt?.getTime() ?? 0;
    if (Date.now() - lastSentAt < RESEND_COOLDOWN_MS) return;

    const now = new Date();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

    await this.userRepository.setPasswordResetToken(user.id, tokenHash, expiresAt, now);

    const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

    try {
      await this.emailService.sendPasswordResetEmail({
        recipientEmail: user.email,
        recipientName: user.firstName,
        resetUrl,
      });
    } catch (error) {
      console.error('[Password reset] Delivery failed:', error);
    }
  }

  async reset(rawToken: string, newPassword: string): Promise<void> {
    if (!rawToken || rawToken.length > 256) {
      throw new Error('INVALID DATA: Password reset link is invalid or has expired');
    }

    const hashedPassword = await hashPassword(newPassword);
    const user = await this.userRepository.resetPasswordByTokenHash(
      this.hashToken(rawToken),
      hashedPassword,
      new Date()
    );

    if (!user) {
      throw new Error('INVALID DATA: Password reset link is invalid or has expired');
    }
  }

  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}

export default PasswordResetService;
