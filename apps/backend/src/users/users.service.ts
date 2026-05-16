import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: string;
    role?: string;
    sort?: string;
    order?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const skip = (page - 1) * perPage;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search } },
        { lastName: { contains: query.search } },
        { username: { contains: query.search } },
        { email: { contains: query.search } },
      ];
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.role) {
      where.role = query.role;
    }

    const orderBy: any = {};
    const sortField = query.sort || 'createdAt';
    const sortOrder = query.order || 'desc';
    orderBy[sortField] = sortOrder;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
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
      this.prisma.user.count({ where }),
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

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
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

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        username: dto.username,
        email: dto.email,
        phoneNumber: dto.phoneNumber,
        password: hashedPassword,
        role: dto.role as UserRole,
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

    await this.prisma.userSettings.create({
      data: { userId: user.id },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    if (dto.email && dto.email !== existingUser.email) {
      const emailTaken = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (emailTaken) {
        throw new ConflictException('Email already in use');
      }
    }

    if (dto.username && dto.username !== existingUser.username) {
      const usernameTaken = await this.prisma.user.findUnique({
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
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber;
    if (dto.status !== undefined) data.status = dto.status as UserStatus;
    if (dto.role !== undefined) data.role = dto.role as UserRole;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 12);
    }

    return this.prisma.user.update({
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
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }

  async bulkDelete(ids: string[]) {
    await this.prisma.user.deleteMany({
      where: { id: { in: ids } },
    });
    return { message: `${ids.length} users deleted successfully` };
  }

  async bulkUpdateStatus(ids: string[], status: string) {
    await this.prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { status: status as UserStatus },
    });
    return { message: `${ids.length} users updated successfully` };
  }
}
