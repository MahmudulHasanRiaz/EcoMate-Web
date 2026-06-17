import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendOtp(email: string, otp: string) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Email service not configured. Set SMTP_* env vars.');
    }
    this.logger.log(`DEV: Sending OTP to ${email}: ${otp}`);
  }

  async sendVerificationEmail(email: string, token: string) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Email service not configured. Set SMTP_* env vars.');
    }
    this.logger.log(`DEV: Sending verification email to ${email}: token=${token}`);
  }
}
