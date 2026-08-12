import crypto from 'crypto';
import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import { LeanUser } from '../types/models/User';
import { EmailService } from './email/EmailService';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

class EmailVerificationService {
  private userRepository: UserRepository;
  private emailService: EmailService;

  constructor() {
    this.userRepository = container.resolve('userRepository');
    this.emailService = container.resolve('emailService');
  }

  async sendForUser(user: LeanUser): Promise<boolean> {
    const now = new Date();
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

    const updated = await this.userRepository.setEmailVerificationToken(
      user.id,
      tokenHash,
      expiresAt,
      now
    );
    if (!updated) throw new Error('NOT FOUND: User not found');

    const frontendUrl = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const verificationUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;

    try {
      await this.emailService.sendVerificationEmail({
        recipientEmail: user.email,
        recipientName: user.firstName,
        verificationUrl,
      });
      return true;
    } catch (error) {
      console.error('[Email verification] Delivery failed:', error);
      return false;
    }
  }

  async verify(rawToken: string): Promise<void> {
    if (!rawToken || rawToken.length > 256) {
      throw new Error('INVALID DATA: Verification link is invalid or has expired');
    }

    const user = await this.userRepository.verifyEmailByTokenHash(this.hashToken(rawToken), new Date());
    if (!user) {
      throw new Error('INVALID DATA: Verification link is invalid or has expired');
    }
  }

  async resend(loginField: string): Promise<void> {
    const normalized = loginField.trim().toLowerCase();
    if (!normalized) return;

    const user = normalized.includes('@')
      ? await this.userRepository.findByEmail(normalized, '+emailVerificationSentAt')
      : await this.userRepository.findByUsername(normalized, '+emailVerificationSentAt');

    if (!user || user.emailVerified !== false) return;

    const lastSentAt = user.emailVerificationSentAt?.getTime() ?? 0;
    if (Date.now() - lastSentAt < RESEND_COOLDOWN_MS) return;

    await this.sendForUser(user);
  }

  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}

export default EmailVerificationService;
