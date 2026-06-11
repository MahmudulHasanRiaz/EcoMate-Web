import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { normalizePhone } from '../common/utils/phone-utils';
import * as bcrypt from 'bcryptjs';
import ms from 'ms';
import type { StringValue } from 'ms';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existingUser) {
      throw new ConflictException(
        'User with this email or username already exists',
      );
    }

    const normalizedPhone = normalizePhone(dto.phoneNumber);
    if (!normalizedPhone) throw new BadRequestException('Invalid phone number');

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        username: dto.username,
        email: dto.email,
        phoneNumber: normalizedPhone,
        password: hashedPassword,
      },
    });

    await this.prisma.userSettings.create({
      data: { userId: user.id },
    });

    await this.sendVerificationEmail(user.id);

    return this.generateTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.generateTokens(user);
  }

  async refresh(userId: string, refreshToken: string) {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      if (tokenRecord) {
        await this.prisma.refreshToken.delete({
          where: { id: tokenRecord.id },
        });
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.generateTokens(user);
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        phoneNumber: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      const otp = String(randomInt(100000, 999999));
      const hashedOtp = await bcrypt.hash(otp, 10);

      await this.prisma.verificationToken.create({
        data: {
          email,
          token: hashedOtp,
          type: 'RESET_PASSWORD',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      await this.emailService.sendOtp(email, otp);
    }
    return { message: 'If the email exists, a reset code has been sent' };
  }

  async verifyOtp(email: string, otp: string) {
    const tokenRecord = await this.prisma.verificationToken.findFirst({
      where: {
        email,
        type: 'RESET_PASSWORD',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const isOtpValid = await bcrypt.compare(otp, tokenRecord.token);
    if (!isOtpValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const resetToken = this.jwtService.sign(
      { sub: tokenRecord.id, email },
      {
        secret: process.env['JWT_SECRET'],
        expiresIn: 300,
      },
    );

    return { resetToken };
  }

  async resetPassword(token: string, password: string) {
    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: process.env['JWT_SECRET'],
      });
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const tokenRecord = await this.prisma.verificationToken.findUnique({
      where: { id: payload.sub },
    });

    if (
      !tokenRecord ||
      tokenRecord.usedAt ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await this.prisma.user.update({
      where: { email: payload.email },
      data: { password: hashedPassword },
    });

    await this.prisma.verificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
    });
    if (user) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: user.id },
      });
    }

    return { message: 'Password has been reset successfully' };
  }

  async sendVerificationEmail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.emailVerified) return;

    const rawToken = randomInt(100000, 999999).toString();
    const hashedToken = await bcrypt.hash(rawToken, 10);

    await this.prisma.verificationToken.create({
      data: {
        email: user.email,
        token: hashedToken,
        type: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await this.emailService.sendVerificationEmail(user.email, rawToken);
  }

  async verifyEmail(token: string) {
    const tokens = await this.prisma.verificationToken.findMany({
      where: {
        type: 'EMAIL_VERIFICATION',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    let matched: (typeof tokens)[0] | null = null;
    for (const t of tokens) {
      if (await bcrypt.compare(token, t.token)) {
        matched = t;
        break;
      }
    }

    if (!matched) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { email: matched.email },
      data: { emailVerified: true },
    });

    await this.prisma.verificationToken.update({
      where: { id: matched.id },
      data: { usedAt: new Date() },
    });

    return { message: 'Email verified successfully' };
  }

  private async generateTokens(user: {
    id: string;
    email: string;
    role: string;
  }) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessExpiresIn = (process.env['JWT_EXPIRES_IN'] ||
      '15m') as StringValue;
    const refreshExpiresIn = (process.env['JWT_REFRESH_EXPIRES_IN'] ||
      '7d') as StringValue;

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env['JWT_SECRET'],
      expiresIn: ms(accessExpiresIn) / 1000,
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id, email: user.email },
      {
        secret: process.env['JWT_REFRESH_SECRET'],
        expiresIn: ms(refreshExpiresIn) / 1000,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + ms(refreshExpiresIn)),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}
