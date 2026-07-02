import { Injectable } from '@nestjs/common';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class EmailService {
  constructor(private emailQueue: EmailQueueService) {}

  async sendOtp(email: string, otp: string) {
    const safeOtp = escapeHtml(otp);
    await this.emailQueue.send({
      to: email,
      subject: 'Your OTP Code',
      context: {
        content: `<p>Your OTP is: <strong>${safeOtp}</strong></p><p>This code expires in 10 minutes.</p>`,
      },
    });
  }

  async sendVerificationEmail(email: string, token: string) {
    const baseUrl = (process.env['APP_URL'] || '').replace(/\/+$/, '');
    const verificationUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.emailQueue.send({
      to: email,
      subject: 'Verify Your Email',
      context: {
        content: `<p>Click <a href="${verificationUrl}">here</a> to verify your email.</p>`,
      },
    });
  }

  async sendMail(to: string, subject: string, html?: string, text?: string) {
    await this.emailQueue.send({
      to,
      subject,
      context: { html, text },
    });
  }
}
