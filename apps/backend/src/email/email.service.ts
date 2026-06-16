import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailService {
  async sendOtp(email: string, otp: string) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Email service not configured. Set SMTP_* env vars.');
    }
    console.log(`[EmailService] DEV: Sending OTP to ${email}: ${otp}`);
  }

  async sendVerificationEmail(email: string, token: string) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Email service not configured. Set SMTP_* env vars.');
    }
    console.log(`[EmailService] DEV: Sending verification email to ${email}: token=${token}`);
  }
}
