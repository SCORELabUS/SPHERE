import { BrevoClient } from '@getbrevo/brevo';
import { EmailService, PasswordResetEmail, VerificationEmail } from './EmailService';

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

class BrevoEmailService implements EmailService {
  private client: BrevoClient | null;

  constructor() {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    this.client = apiKey ? new BrevoClient({ apiKey }) : null;
  }

  async sendVerificationEmail(message: VerificationEmail): Promise<void> {
    if (!this.client) {
      if (process.env.ENVIRONMENT === 'production') {
        throw new Error('ERROR: BREVO_API_KEY is required to send verification emails');
      }

      console.info(`[Email verification] ${message.recipientEmail}: ${message.verificationUrl}`);
      return;
    }

    const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
    if (!senderEmail) {
      throw new Error('ERROR: BREVO_SENDER_EMAIL is required to send verification emails');
    }

    const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'SPHERE';
    const safeName = escapeHtml(message.recipientName);
    const safeUrl = escapeHtml(message.verificationUrl);

    await this.client.transactionalEmails.sendTransacEmail({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: message.recipientEmail, name: message.recipientName }],
      subject: 'Verify your SPHERE email address',
      textContent: `Hello ${message.recipientName}, verify your SPHERE email address by opening this link: ${message.verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
      htmlContent: `
        <!doctype html>
        <html lang="en">
          <body style="margin:0;background:#f7f7f5;font-family:Arial,sans-serif;color:#242424">
            <div style="max-width:560px;margin:0 auto;padding:40px 20px">
              <div style="background:#ffffff;border:1px solid #e8e5df;border-radius:14px;padding:32px">
                <p style="margin:0 0 12px;color:#fa520f;font-weight:700;letter-spacing:.08em">SPHERE</p>
                <h1 style="margin:0 0 16px;font-size:24px">Verify your email address</h1>
                <p style="margin:0 0 24px;line-height:1.6">Hello ${safeName}, confirm that this email belongs to you to activate your SPHERE account.</p>
                <a href="${safeUrl}" style="display:inline-block;border-radius:8px;background:#fa520f;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:600">Verify email</a>
                <p style="margin:24px 0 0;color:#666;font-size:13px;line-height:1.5">This link expires in 24 hours. If you did not create this account, you can ignore this email.</p>
              </div>
            </div>
          </body>
        </html>`,
      tags: ['email-verification'],
    });
  }

  async sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
    if (!this.client) {
      if (process.env.ENVIRONMENT === 'production') {
        throw new Error('ERROR: BREVO_API_KEY is required to send password reset emails');
      }

      console.info(`[Password reset] ${message.recipientEmail}: ${message.resetUrl}`);
      return;
    }

    const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
    if (!senderEmail) {
      throw new Error('ERROR: BREVO_SENDER_EMAIL is required to send password reset emails');
    }

    const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'SPHERE';
    const safeName = escapeHtml(message.recipientName);
    const safeUrl = escapeHtml(message.resetUrl);

    await this.client.transactionalEmails.sendTransacEmail({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: message.recipientEmail, name: message.recipientName }],
      subject: 'Reset your SPHERE password',
      textContent: `Hello ${message.recipientName}, reset your SPHERE password by opening this link: ${message.resetUrl}\n\nThis link expires in 1 hour. If you did not request a password reset, you can ignore this email.`,
      htmlContent: `
        <!doctype html>
        <html lang="en">
          <body style="margin:0;background:#f7f7f5;font-family:Arial,sans-serif;color:#242424">
            <div style="max-width:560px;margin:0 auto;padding:40px 20px">
              <div style="background:#ffffff;border:1px solid #e8e5df;border-radius:14px;padding:32px">
                <p style="margin:0 0 12px;color:#fa520f;font-weight:700;letter-spacing:.08em">SPHERE</p>
                <h1 style="margin:0 0 16px;font-size:24px">Reset your password</h1>
                <p style="margin:0 0 24px;line-height:1.6">Hello ${safeName}, we received a request to reset the password for your SPHERE account. Click the button below to choose a new one.</p>
                <a href="${safeUrl}" style="display:inline-block;border-radius:8px;background:#fa520f;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:600">Reset password</a>
                <p style="margin:24px 0 0;color:#666;font-size:13px;line-height:1.5">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
              </div>
            </div>
          </body>
        </html>`,
      tags: ['password-reset'],
    });
  }
}

export default BrevoEmailService;
