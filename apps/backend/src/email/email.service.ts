import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailService {
  async sendOtp(email: string, otp: string) {
    console.log(`[EmailService] Sending OTP to ${email}: ${otp}`);
  }

  async sendVerificationEmail(email: string, token: string) {
    console.log(
      `[EmailService] Sending verification email to ${email}: token=${token}`,
    );
  }
}
