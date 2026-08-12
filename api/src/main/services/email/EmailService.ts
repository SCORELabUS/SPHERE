export type VerificationEmail = {
  recipientEmail: string;
  recipientName: string;
  verificationUrl: string;
};

export interface EmailService {
  sendVerificationEmail(message: VerificationEmail): Promise<void>;
}
