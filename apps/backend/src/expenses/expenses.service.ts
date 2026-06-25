import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async create(createExpenseDto: CreateExpenseDto) {
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id: createExpenseDto.categoryId } });
    if (!cat) throw new NotFoundException(`Expense category ${createExpenseDto.categoryId} not found`);
    return this.prisma.expense.create({
      data: createExpenseDto,
      include: { category: true },
    });
  }

  async findAll(page = 1, perPage = 10, categoryId?: string, fromDate?: string, toDate?: string) {
    const where: any = {};

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (fromDate) {
      const d = new Date(fromDate);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid fromDate: ${fromDate}`);
      where.expenseDate = { ...where.expenseDate, gte: d };
    }
    if (toDate) {
      const d = new Date(toDate);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid toDate: ${toDate}`);
      where.expenseDate = { ...where.expenseDate, lte: d };
    }

    page = Math.max(1, page);
    perPage = Math.min(100, Math.max(1, perPage));

    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { expenseDate: 'desc' },
        include: { category: true },
      }),
      this.prisma.expense.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }

    return expense;
  }

  async update(id: string, updateExpenseDto: UpdateExpenseDto) {
    await this.findOne(id);
    if (updateExpenseDto.categoryId) {
      const cat = await this.prisma.expenseCategory.findUnique({ where: { id: updateExpenseDto.categoryId } });
      if (!cat) throw new NotFoundException(`Expense category ${updateExpenseDto.categoryId} not found`);
    }
    return this.prisma.expense.update({
      where: { id },
      data: updateExpenseDto,
      include: { category: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.expense.delete({
      where: { id },
    });
  }

  async getSummary(fromDate?: string, toDate?: string) {
    const where: any = {};

    if (fromDate) {
      const d = new Date(fromDate);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid fromDate: ${fromDate}`);
      where.expenseDate = { ...where.expenseDate, gte: d };
    }
    if (toDate) {
      const d = new Date(toDate);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid toDate: ${toDate}`);
      where.expenseDate = { ...where.expenseDate, lte: d };
    }

    const grouped = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      _sum: { amount: true },
      _count: true,
      where,
    });

    const categoryIds = grouped.map(g => g.categoryId);
    const categories = await this.prisma.expenseCategory.findMany({
      where: { id: { in: categoryIds } },
    });
    const catMap = new Map(categories.map(c => [c.id, { id: c.id, name: c.name, slug: c.slug }]));

    return grouped.map(g => ({
      category: catMap.get(g.categoryId) || { id: g.categoryId, name: g.categoryId.slice(0, 8), slug: 'unknown' },
      total: Number(g._sum.amount) || 0,
      count: g._count,
    }));
  }
}
