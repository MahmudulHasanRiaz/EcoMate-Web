import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { normalizePhone } from '../common/utils/phone-utils';
import * as bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@prisma/client';
import { baPrisma } from '../better-auth/prisma';
import { hashPassword } from 'better-auth/crypto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly ALLOWED_SORT_FIELDS = [
    'createdAt',
    'updatedAt',
    'firstName',
    'lastName',
    'email',
    'username',
    'role',
    'status',
  ];

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: string;
    role?: string;
    sort?: string;
    order?: string;
  }) {
    const page = Math.max(query.page || 1, 1);
    const perPage = Math.min(Math.max(query.perPage || 10, 1), 100);
    const skip = (page - 1) * perPage;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.role) {
      if (query.role === 'all_except_customer') {
        where.role = { not: 'customer' };
      } else if (query.role !== 'all') {
        where.role = query.role;
      }
    }

    const orderBy: any = {};
    const sortField =
      query.sort && this.ALLOWED_SORT_FIELDS.includes(query.sort)
        ? query.sort
        : 'createdAt';
    const sortOrder = query.order === 'asc' ? 'asc' : 'desc';
    orderBy[sortField] = sortOrder;

    const [users, total] = await Promise.all([
      this.prisma.userProfile.findMany({
        where,
        skip,
        take: perPage,
        orderBy,
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
      }),
      this.prisma.userProfile.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findByEmail(email: string) {
    const user = await this.prisma.userProfile.findUnique({
      where: { email },
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
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findOne(id: string) {
    const user = await this.prisma.userProfile.findUnique({
      where: { id },
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
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto) {
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

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.userProfile.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          username: dto.username,
          email: dto.email,
          phoneNumber: normalizedPhone,
          password: hashedPassword,
          role: dto.role,
        },
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

      await tx.userSettings.create({
        data: { userId: user.id },
      });

      try {
        const baHashedPassword = await hashPassword(dto.password);
        const { randomUUID } = await import('crypto');
        const baUser = await baPrisma.betterAuthUser.create({
          data: {
            id: randomUUID(),
            name: `${dto.firstName} ${dto.lastName}`,
            email: dto.email,
            emailVerified: false,
            role: dto.role,
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
        await tx.userProfile.update({
          where: { id: user.id },
          data: { betterAuthUserId: baUser.id },
        });
      } catch (err) {
        console.warn(`Failed to create BA user for ${dto.email}`, err);
      }

      return user;
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const existingUser = await this.prisma.userProfile.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    if (dto.email && dto.email !== existingUser.email) {
      const emailTaken = await this.prisma.userProfile.findUnique({
        where: { email: dto.email },
      });
      if (emailTaken) {
        throw new ConflictException('Email already in use');
      }
    }

    if (dto.username && dto.username !== existingUser.username) {
      const usernameTaken = await this.prisma.userProfile.findUnique({
        where: { username: dto.username },
      });
      if (usernameTaken) {
        throw new ConflictException('Username already in use');
      }
    }

    const data: any = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phoneNumber !== undefined) {
      const normalizedPhone = normalizePhone(dto.phoneNumber);
      if (!normalizedPhone)
        throw new BadRequestException('Invalid phone number');
      data.phoneNumber = normalizedPhone;
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 12);
    }

    const updated = await this.prisma.userProfile.update({
      where: { id },
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
    if (existingUser.betterAuthUserId) {
      try {
        const baUserData: any = {};
        if (dto.firstName !== undefined || dto.lastName !== undefined) {
          baUserData.name = `${updated.firstName} ${updated.lastName}`;
        }
        if (dto.email !== undefined) baUserData.email = dto.email;
        if (dto.role !== undefined) baUserData.role = dto.role;
        if (Object.keys(baUserData).length > 0) {
          await baPrisma.betterAuthUser.update({
            where: { id: existingUser.betterAuthUserId },
            data: baUserData,
          });
        }
        if (dto.password) {
          const baHashedPassword = await hashPassword(dto.password);
          await baPrisma.betterAuthAccount.updateMany({
            where: { userId: existingUser.betterAuthUserId, providerId: 'email' },
            data: { password: baHashedPassword },
          });
        }
      } catch (err) {
        console.warn(`Failed to sync BA user for ${id}`, err);
      }
    }

    return updated;
  }

  async remove(id: string) {
    const user = await this.prisma.userProfile.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.betterAuthUserId) {
      try {
        await baPrisma.betterAuthUser.delete({
          where: { id: user.betterAuthUserId },
        });
      } catch (err) {
        console.warn(`Failed to delete BA user ${user.betterAuthUserId}`, err);
      }
    }

    await this.prisma.userProfile.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }

  async bulkDelete(ids: string[]) {
    const users = await this.prisma.userProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, betterAuthUserId: true },
    });

    for (const user of users) {
      if (user.betterAuthUserId) {
        try {
          await baPrisma.betterAuthUser.delete({
            where: { id: user.betterAuthUserId },
          });
        } catch (err) {
          console.warn(`Failed to delete BA user ${user.betterAuthUserId}`, err);
        }
      }
    }

    const result = await this.prisma.userProfile.deleteMany({
      where: { id: { in: ids } },
    });
    return { message: `${result.count} users deleted successfully` };
  }

  async bulkUpdateStatus(ids: string[], status: string) {
    const result = await this.prisma.userProfile.updateMany({
      where: { id: { in: ids } },
      data: { status: status as UserStatus },
    });
    return { message: `${result.count} users updated successfully` };
  }

  async getSettings(userId: string) {
    let settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: { userId },
      });
    }
    return settings;
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }
}
