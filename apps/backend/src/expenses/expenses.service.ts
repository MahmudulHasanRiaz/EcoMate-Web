import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async create(createExpenseDto: CreateExpenseDto) {
    return this.prisma.expense.create({
      data: createExpenseDto,
    });
  }

  async findAll(page = 1, perPage = 10, category?: string, fromDate?: string, toDate?: string) {
    const where: any = {};

    if (category) {
      where.category = category;
    }

    if (fromDate || toDate) {
      where.expenseDate = {};
      if (fromDate) where.expenseDate.gte = new Date(fromDate);
      if (toDate) where.expenseDate.lte = new Date(toDate);
    }

    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { expenseDate: 'desc' },
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
    });

    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }

    return expense;
  }

  async update(id: string, updateExpenseDto: UpdateExpenseDto) {
    await this.findOne(id);

    return this.prisma.expense.update({
      where: { id },
      data: updateExpenseDto,
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

    if (fromDate || toDate) {
      where.expenseDate = {};
      if (fromDate) where.expenseDate.gte = new Date(fromDate);
      if (toDate) where.expenseDate.lte = new Date(toDate);
    }

    const expenses = await this.prisma.expense.findMany({ where });

    const categoryTotals: Record<string, number> = {};
    let grandTotal = 0;

    for (const e of expenses) {
      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + Number(e.amount);
      grandTotal += Number(e.amount);
    }

    return {
      categories: Object.entries(categoryTotals).map(([category, total]) => ({ category, total })),
      grandTotal,
      count: expenses.length,
    };
  }
}
