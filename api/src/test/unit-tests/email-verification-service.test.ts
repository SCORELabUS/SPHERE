import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repository: {
    setEmailVerificationToken: vi.fn(),
    verifyEmailByTokenHash: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
  },
  emailService: {
    sendVerificationEmail: vi.fn(),
  },
}));

vi.mock('../../main/config/container', () => ({
  default: {
    resolve: vi.fn((name: string) => {
      if (name === 'userRepository') return mocks.repository;
      if (name === 'emailService') return mocks.emailService;
      return undefined;
    }),
  },
}));

import EmailVerificationService from '../../main/services/EmailVerificationService';

const pendingUser = {
  id: 'user-1',
  username: 'person',
  password: 'hashed',
  role: 'USER' as const,
  firstName: 'Test',
  lastName: 'Person',
  email: 'person@example.com',
  emailVerified: false,
  apiKeys: [],
};

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.setEmailVerificationToken.mockResolvedValue(pendingUser);
    service = new EmailVerificationService();
  });

  it('stores only a hash and sends a 24-hour verification link', async () => {
    await expect(service.sendForUser(pendingUser)).resolves.toBe(true);

    const [, storedHash, expiresAt, sentAt] = mocks.repository.setEmailVerificationToken.mock.calls[0];
    const email = mocks.emailService.sendVerificationEmail.mock.calls[0][0];
    const rawToken = new URL(email.verificationUrl).searchParams.get('token');

    expect(rawToken).toBeTruthy();
    expect(storedHash).toBe(crypto.createHash('sha256').update(rawToken!).digest('hex'));
    expect(storedHash).not.toBe(rawToken);
    expect(expiresAt.getTime() - sentAt.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(email).toMatchObject({
      recipientEmail: pendingUser.email,
      recipientName: pendingUser.firstName,
    });
  });

  it('consumes a token through an atomic hash lookup', async () => {
    mocks.repository.verifyEmailByTokenHash.mockResolvedValue({ ...pendingUser, emailVerified: true });

    await service.verify('raw-token');

    expect(mocks.repository.verifyEmailByTokenHash).toHaveBeenCalledWith(
      crypto.createHash('sha256').update('raw-token').digest('hex'),
      expect.any(Date)
    );
  });

  it('rejects invalid or already consumed tokens', async () => {
    mocks.repository.verifyEmailByTokenHash.mockResolvedValue(null);

    await expect(service.verify('expired-token')).rejects.toThrow('invalid or has expired');
  });

  it('does not reveal unknown accounts during resend', async () => {
    mocks.repository.findByEmail.mockResolvedValue(null);

    await expect(service.resend('unknown@example.com')).resolves.toBeUndefined();
    expect(mocks.emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('enforces the resend cooldown', async () => {
    mocks.repository.findByEmail.mockResolvedValue({
      ...pendingUser,
      emailVerificationSentAt: new Date(),
    });

    await service.resend(pendingUser.email);

    expect(mocks.repository.setEmailVerificationToken).not.toHaveBeenCalled();
    expect(mocks.emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });
});
