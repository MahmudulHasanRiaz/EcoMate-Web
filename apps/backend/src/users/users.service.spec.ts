import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

import * as bcrypt from 'bcryptjs';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  const mockUser = {
    id: 'user-id-1',
    firstName: 'John',
    lastName: 'Doe',
    username: 'johndoe',
    email: 'john@example.com',
    phoneNumber: '+8801712345678',
    password: '$2a$12$hashedpassword',
    status: 'active',
    role: 'customer',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockUserResponse = {
    id: 'user-id-1',
    firstName: 'John',
    lastName: 'Doe',
    username: 'johndoe',
    email: 'john@example.com',
    phoneNumber: '+8801712345678',
    status: 'active',
    role: 'customer',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
              count: jest.fn(),
            },
            userSettings: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([mockUserResponse]);
      (prisma.user.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, perPage: 10 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(prisma.user.count).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        perPage: 10,
        totalPages: 1,
      });
    });

    it('should filter by search term across name, username, and email', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ search: 'john', page: 1, perPage: 10 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { firstName: { contains: 'john', mode: 'insensitive' } },
              { lastName: { contains: 'john', mode: 'insensitive' } },
              { username: { contains: 'john', mode: 'insensitive' } },
              { email: { contains: 'john', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('should filter by status and role', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ status: 'active', role: 'customer' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'active', role: 'customer' },
        }),
      );
    });

    it('should use default sort by createdAt desc', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.user.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('should handle custom sorting', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([mockUserResponse]);
      (prisma.user.count as jest.Mock).mockResolvedValue(1);

      await service.findAll({ sort: 'email', order: 'asc' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { email: 'asc' } }),
      );
    });

    it('should handle second page correctly', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([mockUserResponse]);
      (prisma.user.count as jest.Mock).mockResolvedValue(11);

      await service.findAll({ page: 2, perPage: 10 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUserResponse);

      const result = await service.findOne('user-id-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-id-1' } }),
      );
      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('user-id-1');
    });

    it('should throw NotFoundException if user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const createDto = {
      firstName: 'Jane',
      lastName: 'Smith',
      username: 'janesmith',
      email: 'jane@example.com',
      phoneNumber: '01798765432',
      password: 'securepassword',
      role: 'admin',
    };

    it('should create a user successfully', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-id-2',
        firstName: 'Jane',
        lastName: 'Smith',
        username: 'janesmith',
        email: 'jane@example.com',
        phoneNumber: '+8801798765432',
        status: 'active',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.userSettings.create as jest.Mock).mockResolvedValue({
        id: 'settings-2',
        userId: 'user-id-2',
      });

      const result = await service.create(createDto);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ email: createDto.email }, { username: createDto.username }],
        },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(createDto.password, 12);
      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.userSettings.create).toHaveBeenCalledWith({
        data: { userId: 'user-id-2' },
      });
      expect(result).not.toHaveProperty('password');
    });

    it('should throw ConflictException if email or username exists', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockUser);

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const updateDto = {
      firstName: 'Johnny',
      email: 'johnny@example.com',
    };

    it('should update a user successfully', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUserResponse)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      (prisma.user.update as jest.Mock).mockResolvedValue({
        ...mockUserResponse,
        firstName: 'Johnny',
        email: 'johnny@example.com',
      });

      const result = await service.update('user-id-1', updateDto);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-id-1' } }),
      );
      expect(result.firstName).toBe('Johnny');
      expect(result.email).toBe('johnny@example.com');
    });

    it('should throw NotFoundException if user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.update('nonexistent-id', updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if new email is already taken', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUserResponse)
        .mockResolvedValueOnce({
          id: 'other-user',
          email: 'johnny@example.com',
        });

      await expect(
        service.update('user-id-1', { email: 'johnny@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if new username is already taken', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUserResponse)
        .mockResolvedValueOnce({ id: 'other-user', username: 'takenuser' });

      await expect(
        service.update('user-id-1', { username: 'takenuser' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should hash password when updating password', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUserResponse)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('$2a$12$newhashed');
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUserResponse);

      await service.update('user-id-1', { password: 'newpassword123' });

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 12);
    });

    it('should omit status, role, password from the data if not provided', async () => {
      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockUserResponse)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      (prisma.user.update as jest.Mock).mockResolvedValue(mockUserResponse);

      await service.update('user-id-1', { firstName: 'Johnny' });

      const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('password');
      expect(updateCall.data).not.toHaveProperty('status');
      expect(updateCall.data).not.toHaveProperty('role');
    });
  });

  describe('remove', () => {
    it('should delete a user successfully', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUserResponse);
      (prisma.user.delete as jest.Mock).mockResolvedValue(mockUserResponse);

      const result = await service.remove('user-id-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-id-1' },
      });
      expect(result).toEqual({ message: 'User deleted successfully' });
    });

    it('should throw NotFoundException if user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('bulkDelete', () => {
    it('should delete multiple users', async () => {
      const ids = ['user-id-1', 'user-id-2', 'user-id-3'];
      (prisma.user.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await service.bulkDelete(ids);

      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ids } },
      });
      expect(result).toEqual({ message: '3 users deleted successfully' });
    });

    it('should handle empty array without error', async () => {
      (prisma.user.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await service.bulkDelete([]);

      expect(result).toEqual({ message: '0 users deleted successfully' });
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should update status for multiple users', async () => {
      const ids = ['user-id-1', 'user-id-2'];
      (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      const result = await service.bulkUpdateStatus(ids, 'inactive');

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ids } },
        data: { status: 'inactive' },
      });
      expect(result).toEqual({ message: '2 users updated successfully' });
    });
  });
});
