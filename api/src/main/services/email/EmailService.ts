export type VerificationEmail = {
  recipientEmail: string;
  recipientName: string;
  verificationUrl: string;
};

export type PasswordResetEmail = {
  recipientEmail: string;
  recipientName: string;
  resetUrl: string;
};

export interface EmailService {
  sendVerificationEmail(message: VerificationEmail): Promise<void>;
  sendPasswordResetEmail(message: PasswordResetEmail): Promise<void>;
}
