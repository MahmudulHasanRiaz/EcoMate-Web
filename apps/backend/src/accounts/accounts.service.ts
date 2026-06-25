import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAccountDto, userId?: string) {
    const existing = await this.prisma.account.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`Account with code ${dto.code} already exists`);

    if (dto.parentId) {
      const parent = await this.prisma.account.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException(`Parent account with ID ${dto.parentId} not found`);
      if (!parent.isGroup) throw new BadRequestException('Parent account must be a group account');
    }

    return this.prisma.account.create({
      data: { ...dto, createdBy: userId },
      include: { children: true },
    });
  }

  async findAll(type?: string) {
    const where: any = {};
    if (type) where.type = type;

    return this.prisma.account.findMany({
      where,
      include: { children: true },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { children: true },
    });
    if (!account) throw new NotFoundException(`Account with ID ${id} not found`);
    return account;
  }

  async update(id: string, dto: UpdateAccountDto) {
    await this.findOne(id);
    return this.prisma.account.update({
      where: { id },
      data: dto,
      include: { children: true },
    });
  }

  async remove(id: string) {
    const account = await this.findOne(id);
    if (account.children && account.children.length > 0) {
      throw new BadRequestException('Cannot delete account with children');
    }
    return this.prisma.account.delete({ where: { id } });
  }

  async getChartOfAccounts() {
    const accounts = await this.prisma.account.findMany({
      where: { parentId: null },
      include: {
        children: {
          include: {
            children: true,
          },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    return accounts;
  }
}
