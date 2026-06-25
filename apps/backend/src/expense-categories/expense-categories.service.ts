import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense-category.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(private prisma: PrismaService) {}

  private include = {
    _count: { select: { expenses: true } },
    account: { select: { id: true, code: true, name: true } },
  };

  async create(dto: CreateExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Category with slug "${dto.slug}" already exists`);

    if (dto.accountId) {
      const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
      if (!account) throw new NotFoundException(`Account ${dto.accountId} not found`);
      if (account.type !== 'expense') {
        throw new BadRequestException(`Account "${account.code}" is of type ${account.type}, not expense`);
      }
    }

    return this.prisma.expenseCategory.create({ data: dto, include: this.include });
  }

  async findAll() {
    return this.prisma.expenseCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: this.include,
    });
  }

  async findOne(id: string) {
    const cat = await this.prisma.expenseCategory.findUnique({
      where: { id },
      include: this.include,
    });
    if (!cat) throw new NotFoundException(`Expense category ${id} not found`);
    return cat;
  }

  async update(id: string, dto: UpdateExpenseCategoryDto) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided for update');
    }
    await this.findOne(id);
    if (dto.slug) {
      const existing = await this.prisma.expenseCategory.findUnique({ where: { slug: dto.slug } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Category with slug "${dto.slug}" already exists`);
      }
    }
    if (dto.accountId) {
      const account = await this.prisma.account.findUnique({ where: { id: dto.accountId } });
      if (!account) throw new NotFoundException(`Account ${dto.accountId} not found`);
      if (account.type !== 'expense') {
        throw new BadRequestException(`Account "${account.code}" is of type ${account.type}, not expense`);
      }
    }
    return this.prisma.expenseCategory.update({ where: { id }, data: dto, include: this.include });
  }

  async remove(id: string) {
    await this.findOne(id);
    const count = await this.prisma.expense.count({ where: { categoryId: id } });
    if (count > 0) {
      throw new ConflictException(`Cannot delete: ${count} expense(s) use this category`);
    }
    return this.prisma.expenseCategory.delete({ where: { id } });
  }
}
