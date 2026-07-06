import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockUser = {
    id: 'user-id-1',
    email: 'test@example.com',
    role: 'customer',
    firstName: 'John',
    lastName: 'Doe',
    username: 'johndoe',
    phoneNumber: '+8801712345678',
    password: '$2a$12$hashedpassword',
    status: 'active',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockTokenRecord = {
    id: 'token-id-1',
    token: 'refresh-token-string',
    userId: 'user-id-1',
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  };

  const mockExpiredToken = {
    id: 'token-id-expired',
    token: 'expired-token',
    userId: 'user-id-1',
    expiresAt: new Date(Date.now() - 86400000),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            userProfile: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            userSettings: {
              create: jest.fn(),
            },
            refreshToken: {
              findUnique: jest.fn(),
              create: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            verificationToken: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendOtp: jest.fn().mockResolvedValue(undefined),
            sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const registerDto = {
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
      email: 'test@example.com',
      password: 'password123',
      phoneNumber: '01712345678',
    };

    it('should register a new user successfully', async () => {
      (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.userProfile.create as jest.Mock).mockResolvedValue(mockUser);
      (prisma.userSettings.create as jest.Mock).mockResolvedValue({
        id: 'settings-id',
        userId: mockUser.id,
      });
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue(
        mockTokenRecord,
      );
      (prisma.verificationToken.create as jest.Mock).mockResolvedValue({
        id: 'verification-id',
      });

      const result = await service.register(registerDto);

      expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [
            { email: registerDto.email },
            { username: registerDto.username },
          ],
        },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 12);
      expect(prisma.userProfile.create).toHaveBeenCalledWith({
        data: {
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          username: registerDto.username,
          email: registerDto.email,
          phoneNumber: '+8801712345678',
          password: '$2a$12$hashedpassword',
        },
      });
      expect(prisma.userSettings.create).toHaveBeenCalledWith({
        data: { userId: mockUser.id },
      });
      expect(result).toEqual({
        accessToken: 'access-token-mock',
        refreshToken: 'refresh-token-mock',
        user: { id: mockUser.id, email: mockUser.email, role: mockUser.role },
      });
    });

    it('should throw ConflictException if user with email or username exists', async () => {
      (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.userProfile.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password123' };

    it('should login successfully with valid credentials', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('access-token-mock')
        .mockReturnValueOnce('refresh-token-mock');
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue(
        mockTokenRecord,
      );

      const result = await service.login(loginDto);

      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { email: loginDto.email },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        mockUser.password,
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('should throw UnauthorizedException if account is not active', async () => {
      const inactiveUser = { ...mockUser, status: 'inactive' };
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(inactiveUser);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Account is not active',
      );
    });

    it('should throw UnauthorizedException if password is incorrect', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid email or password',
      );
    });
  });

  describe('refresh', () => {
    const userId = 'user-id-1';
    const refreshToken = 'valid-refresh-token';

    it('should refresh tokens successfully', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(
        mockTokenRecord,
      );
      (prisma.refreshToken.delete as jest.Mock).mockResolvedValue(
        mockTokenRecord,
      );
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({
        ...mockTokenRecord,
        token: 'new-refresh-token',
      });

      const result = await service.refresh(userId, refreshToken);

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: refreshToken },
      });
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: mockTokenRecord.id },
      });
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
    });

    it('should throw UnauthorizedException if refresh token not found', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh(userId, 'invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refresh(userId, 'invalid-token')).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });

    it('should throw UnauthorizedException if refresh token is expired', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(
        mockExpiredToken,
      );
      (prisma.refreshToken.delete as jest.Mock).mockResolvedValue(
        mockExpiredToken,
      );

      await expect(service.refresh(userId, 'expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: mockExpiredToken.id },
      });
    });

    it('should throw UnauthorizedException if user not found after token valid', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(
        mockTokenRecord,
      );
      (prisma.refreshToken.delete as jest.Mock).mockResolvedValue(
        mockTokenRecord,
      );
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh(userId, refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should logout and clear refresh tokens', async () => {
      (prisma.refreshToken.deleteMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const result = await service.logout('user-id-1');

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-id-1' },
      });
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  describe('me', () => {
    it('should return current user profile', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
        id: mockUser.id,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        username: mockUser.username,
        email: mockUser.email,
        phoneNumber: mockUser.phoneNumber,
        status: mockUser.status,
        role: mockUser.role,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });

      const result = await service.me('user-id-1');

      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        select: expect.objectContaining({ id: true, email: true }),
      });
      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('user-id-1');
      expect(result.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.me('nonexistent-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('changePassword', () => {
    const changePasswordDto = {
      currentPassword: 'oldPassword123',
      newPassword: 'newPassword456',
    };

    it('should change password successfully', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce(
        '$2a$12$newhashedpassword',
      );
      (prisma.userProfile.update as jest.Mock).mockResolvedValue({
        ...mockUser,
        password: '$2a$12$newhashedpassword',
      });
      (prisma.refreshToken.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await service.changePassword(
        'user-id-1',
        changePasswordDto,
      );

      expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        changePasswordDto.currentPassword,
        mockUser.password,
      );
      expect(bcrypt.hash).toHaveBeenCalledWith(
        changePasswordDto.newPassword,
        12,
      );
      expect(prisma.userProfile.update).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
        data: { password: '$2a$12$newhashedpassword' },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-id-1' },
      });
      expect(result).toEqual({ message: 'Password changed successfully' });
    });

    it('should throw BadRequestException if new password equals current password', async () => {
      const samePasswordDto = {
        currentPassword: 'samepass',
        newPassword: 'samepass',
      };

      await expect(
        service.changePassword('user-id-1', samePasswordDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changePassword('user-id-1', samePasswordDto),
      ).rejects.toThrow('New password must be different from current password');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.changePassword('nonexistent-id', changePasswordDto),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException if current password is incorrect', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-id-1', changePasswordDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changePassword('user-id-1', changePasswordDto),
      ).rejects.toThrow('Current password is incorrect');
    });
  });

  describe('forgotPassword', () => {
    it('should return a generic message even if user not found', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.forgotPassword('nonexistent@example.com');

      expect(result).toEqual({
        message: 'If the email exists, a reset code has been sent',
      });
    });

    it('should return a generic message if user exists', async () => {
      (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.forgotPassword('test@example.com');

      expect(result).toEqual({
        message: 'If the email exists, a reset code has been sent',
      });
    });
  });
});
