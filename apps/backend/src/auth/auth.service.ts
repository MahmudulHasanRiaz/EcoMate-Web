import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt, randomUUID, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { baPrisma } from '../better-auth/prisma';
import { hashPassword } from 'better-auth/crypto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { normalizePhone } from '../common/utils/phone-utils';
import * as bcrypt from 'bcryptjs';
import ms from 'ms';
import type { StringValue } from 'ms';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.userProfile.findFirst({
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
    const user = await this.prisma.userProfile.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        username: dto.username,
        email: dto.email,
        phoneNumber: normalizedPhone,
        password: hashedPassword,
        role: 'customer',
      },
    });

    await this.prisma.userSettings.create({
      data: { userId: user.id },
    });

    // Create BA user+account for the new user
    try {
      const baHashedPassword = await hashPassword(dto.password);
      const baUser = await baPrisma.betterAuthUser.create({
        data: {
          id: randomUUID(),
          name: `${dto.firstName} ${dto.lastName}`,
          email: dto.email,
          emailVerified: false,
          role: 'customer',
        },
      });
      await baPrisma.betterAuthAccount.create({
        data: {
          id: randomUUID(),
          userId: baUser.id,
          accountId: dto.email,
          providerId: 'email',
          password: baHashedPassword,
        },
      });
      await this.prisma.userProfile.update({
        where: { id: user.id },
        data: { betterAuthUserId: baUser.id },
      });
    } catch (err) {
      this.logger.warn(`Failed to create BA user for ${dto.email}`, err);
    }

    this.sendVerificationEmail(user.id).catch((err) =>
      this.logger.error(
        'Failed to send verification email after registration',
        err,
      ),
    );

    return this.generateTokens(user);
  }

  async login(dto: LoginDto) {
    console.log(
      `[LOGIN ATTEMPT] Email: "${dto.email}", Password length: ${dto.password?.length}`,
    );
    const user = await this.prisma.userProfile.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      console.log(`[LOGIN FAILED] User not found for email: "${dto.email}"`);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      console.log(`[LOGIN FAILED] User not active. Status: ${user.status}`);
      throw new UnauthorizedException('Account is not active');
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      console.log(`[LOGIN FAILED] User locked out until: ${user.lockoutUntil}`);
      throw new UnauthorizedException(
        'Account is temporarily locked due to too many failed login attempts. Please try again later.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    console.log(`[LOGIN ATTEMPT] Password valid? ${isPasswordValid}`);

    if (!isPasswordValid) {
      // Increment failed attempts in one atomic operation
      // If this is the 5th attempt (attempts was 4), also lock the account
      const result = await this.prisma.userProfile.updateMany({
        where: {
          id: user.id,
          failedLoginAttempts: { lt: 4 },
        },
        data: {
          failedLoginAttempts: { increment: 1 },
          ...(user.failedLoginAttempts === 3
            ? { lockoutUntil: new Date(Date.now() + 15 * 60 * 1000) }
            : {}),
        },
      });

      // If result.count === 0, either user doesn't exist or attempts >= 4
      if (result.count === 0) {
        // Already at the limit — account should already be locked
        throw new UnauthorizedException(
          'Too many failed login attempts. Your account has been temporarily locked. Please try again later.',
        );
      }

      // If this was the lockout trigger attempt
      if (user.failedLoginAttempts === 3) {
        throw new UnauthorizedException(
          'Too many failed login attempts. Your account has been temporarily locked. Please try again later.',
        );
      }

      throw new UnauthorizedException('Invalid email or password');
    }

    // BA password migration: silently create BA user+account for legacy users
    if (!user.betterAuthUserId) {
      try {
        const baHashedPassword = await hashPassword(dto.password);
        const baUser = await baPrisma.betterAuthUser.create({
          data: {
            id: randomUUID(),
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            emailVerified: user.emailVerified,
            role: user.role,
          },
        });
        await baPrisma.betterAuthAccount.create({
          data: {
            id: randomUUID(),
            userId: baUser.id,
            accountId: user.email,
            providerId: 'email',
            password: baHashedPassword,
          },
        });
        await this.prisma.userProfile.update({
          where: { id: user.id },
          data: { betterAuthUserId: baUser.id },
        });
        this.logger.log(`BA user created for legacy user ${user.email}`);
      } catch (err) {
        this.logger.warn(`Failed to migrate user ${user.email} to BA`, err);
      }
    }

    const tokens = await this.generateTokens(user);

    // Reset failed login attempts on successful login
    if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
      await this.prisma.userProfile.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockoutUntil: null,
        },
      });
    }

    return tokens;
  }

  async refresh(userId: string, refreshToken: string) {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      if (tokenRecord) {
        await this.prisma.refreshToken.deleteMany({
          where: { id: tokenRecord.id },
        });
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.deleteMany({
      where: { id: tokenRecord.id },
    });

    const user = await this.prisma.userProfile.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.generateTokens(user);
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { token: refreshToken, userId },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({
        where: { userId },
      });
    }

    // Revoke BA sessions for this user
    try {
      const user = await this.prisma.userProfile.findUnique({
        where: { id: userId },
        select: { betterAuthUserId: true },
      });
      if (user?.betterAuthUserId) {
        await baPrisma.betterAuthSession.deleteMany({
          where: { userId: user.betterAuthUserId },
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to revoke BA sessions for user ${userId}`, err);
    }

    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const user = await this.prisma.userProfile.findUnique({
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

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: any = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) {
      const existing = await this.prisma.userProfile.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Email is already in use');
      }
      data.email = dto.email;
    }
    if (dto.phoneNumber !== undefined) {
      const normalized = normalizePhone(dto.phoneNumber);
      if (!normalized) throw new BadRequestException('Invalid phone number');
      data.phoneNumber = normalized;
    }

    const user = await this.prisma.userProfile.findUnique({
      where: { id: userId },
      select: {
        id: true,
        betterAuthUserId: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const updated = await this.prisma.userProfile.update({
      where: { id: userId },
      data,
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

    // Sync to BA
    if (user.betterAuthUserId) {
      try {
        const baData: any = {};
        if (dto.email !== undefined) baData.email = dto.email;
        if (dto.firstName !== undefined || dto.lastName !== undefined) {
          baData.name = `${updated.firstName} ${updated.lastName}`;
        }
        if (Object.keys(baData).length > 0) {
          await baPrisma.betterAuthUser.update({
            where: { id: user.betterAuthUserId },
            data: baData,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Failed to sync profile to BA for user ${userId}`,
          err,
        );
      }
    }

    return updated;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const user = await this.prisma.userProfile.findUnique({
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
    await this.prisma.userProfile.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Sync password to BA if user has been migrated
    if (user.betterAuthUserId) {
      try {
        const baHashedPassword = await hashPassword(dto.newPassword);
        await baPrisma.betterAuthAccount.updateMany({
          where: { userId: user.betterAuthUserId, providerId: 'email' },
          data: { password: baHashedPassword },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to sync password to BA for user ${userId}`,
          err,
        );
      }
    }

    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return { message: 'Password changed successfully' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.userProfile.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) {
      const rawToken = randomInt(100000, 999999).toString();
      const hashedToken = createHash('sha256')
        .update(rawToken + (process.env['JWT_SECRET'] || ''))
        .digest('hex');

      await this.prisma.verificationToken.create({
        data: {
          email,
          token: hashedToken,
          type: 'RESET_PASSWORD',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      await this.emailService.sendOtp(email, rawToken).catch((err) => {
        this.logger.error('Failed to send OTP email', err);
      });
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

    const hashedOtp = createHash('sha256')
      .update(otp + (process.env['JWT_SECRET'] || ''))
      .digest('hex');
    const isOtpValid = hashedOtp === tokenRecord.token;
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
    const updatedUser = await this.prisma.userProfile.update({
      where: { email: payload.email },
      data: { password: hashedPassword },
    });

    await this.prisma.verificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    // Sync password to BA if user has been migrated
    if (updatedUser.betterAuthUserId) {
      try {
        const baHashedPassword = await hashPassword(password);
        await baPrisma.betterAuthAccount.updateMany({
          where: { userId: updatedUser.betterAuthUserId, providerId: 'email' },
          data: { password: baHashedPassword },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to sync reset password to BA for ${payload.email}`,
          err,
        );
      }
    }

    await this.prisma.refreshToken.deleteMany({
      where: { userId: updatedUser.id },
    });

    return { message: 'Password has been reset successfully' };
  }

  async sendVerificationEmail(userId: string) {
    const user = await this.prisma.userProfile.findUnique({
      where: { id: userId },
      select: { emailVerified: true, email: true },
    });
    if (!user || user.emailVerified) return;

    const rawToken = randomInt(100000, 999999).toString();
    const hashedToken = createHash('sha256')
      .update(rawToken + (process.env['JWT_SECRET'] || ''))
      .digest('hex');

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
    const hashedToken = createHash('sha256')
      .update(token + (process.env['JWT_SECRET'] || ''))
      .digest('hex');
    const matched = await this.prisma.verificationToken.findFirst({
      where: {
        token: hashedToken,
        type: 'EMAIL_VERIFICATION',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!matched) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const updatedUser = await this.prisma.userProfile.update({
      where: { email: matched.email },
      data: { emailVerified: true },
    });

    if (updatedUser.betterAuthUserId) {
      try {
        await baPrisma.betterAuthUser.update({
          where: { id: updatedUser.betterAuthUserId },
          data: { emailVerified: true },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to sync email verification to BA for user ${updatedUser.id}`,
          err,
        );
      }
    }

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
