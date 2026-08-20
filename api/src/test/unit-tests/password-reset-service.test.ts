import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repository: {
    setPasswordResetToken: vi.fn(),
    resetPasswordByTokenHash: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
  },
  emailService: {
    sendPasswordResetEmail: vi.fn(),
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

import PasswordResetService from '../../main/services/PasswordResetService';

const localUser = {
  id: 'user-1',
  username: 'person',
  password: 'hashed',
  role: 'USER' as const,
  firstName: 'Test',
  lastName: 'Person',
  email: 'person@example.com',
  emailVerified: true,
  apiKeys: [],
};

const ssoOnlyUser = { ...localUser, password: '' };

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.setPasswordResetToken.mockResolvedValue(localUser);
    service = new PasswordResetService();
  });

  it('stores only a hash and sends a 1-hour reset link', async () => {
    mocks.repository.findByEmail.mockResolvedValue(localUser);

    await service.requestReset(localUser.email);

    const [, storedHash, expiresAt, sentAt] = mocks.repository.setPasswordResetToken.mock.calls[0];
    const email = mocks.emailService.sendPasswordResetEmail.mock.calls[0][0];
    const rawToken = new URL(email.resetUrl).searchParams.get('token');

    expect(rawToken).toBeTruthy();
    expect(storedHash).toBe(crypto.createHash('sha256').update(rawToken!).digest('hex'));
    expect(storedHash).not.toBe(rawToken);
    expect(expiresAt.getTime() - sentAt.getTime()).toBe(60 * 60 * 1000);
    expect(email).toMatchObject({
      recipientEmail: localUser.email,
      recipientName: localUser.firstName,
    });
  });

  it('does not reveal unknown accounts', async () => {
    mocks.repository.findByEmail.mockResolvedValue(null);

    await expect(service.requestReset('unknown@example.com')).resolves.toBeUndefined();
    expect(mocks.emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('does not send a reset email for SSO-only accounts without a local password', async () => {
    mocks.repository.findByUsername.mockResolvedValue(ssoOnlyUser);

    await service.requestReset(ssoOnlyUser.username);

    expect(mocks.repository.setPasswordResetToken).not.toHaveBeenCalled();
    expect(mocks.emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('enforces the resend cooldown', async () => {
    mocks.repository.findByEmail.mockResolvedValue({
      ...localUser,
      passwordResetSentAt: new Date(),
    });

    await service.requestReset(localUser.email);

    expect(mocks.repository.setPasswordResetToken).not.toHaveBeenCalled();
    expect(mocks.emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('consumes a token through an atomic hash lookup and hashes the new password', async () => {
    mocks.repository.resetPasswordByTokenHash.mockResolvedValue({ ...localUser, password: 'new-hash' });

    await service.reset('raw-token', 'new-password123');

    const [tokenHash, hashedPassword] = mocks.repository.resetPasswordByTokenHash.mock.calls[0];
    expect(tokenHash).toBe(crypto.createHash('sha256').update('raw-token').digest('hex'));
    expect(hashedPassword).not.toBe('new-password123');
  });

  it('rejects invalid or already consumed tokens', async () => {
    mocks.repository.resetPasswordByTokenHash.mockResolvedValue(null);

    await expect(service.reset('expired-token', 'new-password123')).rejects.toThrow('invalid or has expired');
  });
});
