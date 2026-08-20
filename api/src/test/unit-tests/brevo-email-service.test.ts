import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendTransacEmail: vi.fn(),
  client: vi.fn(),
}));

vi.mock('@getbrevo/brevo', () => ({
  BrevoClient: function (options: unknown) {
    mocks.client(options);
    return {
      transactionalEmails: {
        sendTransacEmail: mocks.sendTransacEmail,
      },
    };
  },
}));

import BrevoEmailService from '../../main/services/email/BrevoEmailService';

describe('BrevoEmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ENVIRONMENT', 'testing');
    vi.stubEnv('BREVO_API_KEY', 'test-api-key');
    vi.stubEnv('BREVO_SENDER_EMAIL', 'no-reply@example.com');
    vi.stubEnv('BREVO_SENDER_NAME', 'SPHERE');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends a transactional verification email through the Brevo SDK', async () => {
    const service = new BrevoEmailService();

    await service.sendVerificationEmail({
      recipientEmail: 'person@example.com',
      recipientName: 'Test Person',
      verificationUrl: 'https://sphere.example/verify-email?token=safe-token',
    });

    expect(mocks.client).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    expect(mocks.sendTransacEmail).toHaveBeenCalledWith(expect.objectContaining({
      sender: { name: 'SPHERE', email: 'no-reply@example.com' },
      to: [{ email: 'person@example.com', name: 'Test Person' }],
      subject: 'Verify your SPHERE email address',
      tags: ['email-verification'],
    }));
  });

  it('refuses to silently skip delivery in production without an API key', async () => {
    vi.stubEnv('ENVIRONMENT', 'production');
    vi.stubEnv('BREVO_API_KEY', '');
    const service = new BrevoEmailService();

    await expect(service.sendVerificationEmail({
      recipientEmail: 'person@example.com',
      recipientName: 'Test Person',
      verificationUrl: 'https://sphere.example/verify-email?token=safe-token',
    })).rejects.toThrow('BREVO_API_KEY');
  });

  it('sends a transactional password reset email through the Brevo SDK', async () => {
    const service = new BrevoEmailService();

    await service.sendPasswordResetEmail({
      recipientEmail: 'person@example.com',
      recipientName: 'Test Person',
      resetUrl: 'https://sphere.example/reset-password?token=safe-token',
    });

    expect(mocks.client).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    expect(mocks.sendTransacEmail).toHaveBeenCalledWith(expect.objectContaining({
      sender: { name: 'SPHERE', email: 'no-reply@example.com' },
      to: [{ email: 'person@example.com', name: 'Test Person' }],
      subject: 'Reset your SPHERE password',
      tags: ['password-reset'],
    }));
  });

  it('refuses to silently skip password reset delivery in production without an API key', async () => {
    vi.stubEnv('ENVIRONMENT', 'production');
    vi.stubEnv('BREVO_API_KEY', '');
    const service = new BrevoEmailService();

    await expect(service.sendPasswordResetEmail({
      recipientEmail: 'person@example.com',
      recipientName: 'Test Person',
      resetUrl: 'https://sphere.example/reset-password?token=safe-token',
    })).rejects.toThrow('BREVO_API_KEY');
  });
});
