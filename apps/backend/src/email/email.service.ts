import { Injectable } from '@nestjs/common';
import { EmailQueueService } from '../queue/email-queue/email-queue.service';

@Injectable()
export class EmailService {
  constructor(private emailQueue: EmailQueueService) {}

  async sendOtp(email: string, otp: string) {
    await this.emailQueue.send({
      to: email,
      subject: 'Your OTP Code',
      context: { content: `<p>Your OTP is: <strong>${otp}</strong></p><p>This code expires in 10 minutes.</p>` },
    });
  }

  async sendVerificationEmail(email: string, token: string) {
    const verificationUrl = `${process.env['APP_URL'] || ''}/verify-email?token=${token}`;
    await this.emailQueue.send({
      to: email,
      subject: 'Verify Your Email',
      context: { content: `<p>Click <a href="${verificationUrl}">here</a> to verify your email.</p>` },
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
