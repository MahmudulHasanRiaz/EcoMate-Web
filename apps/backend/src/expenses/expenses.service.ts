import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  private expenseInclude = {
    category: {
      include: { account: { select: { id: true, code: true, name: true } } },
    },
    paymentAccount: { select: { id: true, code: true, name: true } },
    journalEntry: {
      include: {
        lines: { include: { account: { select: { id: true, code: true, name: true } } } },
        period: { select: { id: true, name: true } },
      },
    },
  };

  async create(createExpenseDto: CreateExpenseDto, userId?: string) {
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id: createExpenseDto.categoryId } });
    if (!cat) throw new NotFoundException(`Expense category ${createExpenseDto.categoryId} not found`);

    // Validate paymentAccountId is asset-type if provided
    if (createExpenseDto.paymentAccountId) {
      const acct = await this.prisma.account.findUnique({ where: { id: createExpenseDto.paymentAccountId } });
      if (!acct) throw new NotFoundException(`Payment account ${createExpenseDto.paymentAccountId} not found`);
      if (acct.type !== 'asset') throw new BadRequestException('Payment account must be an Asset-type account (Cash/Bank)');
    }

    // Check accounting_enabled
    const accountingEnabled = await this.isAccountingEnabled();

    // Warn if accounting enabled but no financial period exists
    if (accountingEnabled && cat.accountId && createExpenseDto.paymentAccountId) {
      const periodExists = await this.prisma.financialPeriod.findFirst({
        where: { startDate: { lte: createExpenseDto.expenseDate }, endDate: { gte: createExpenseDto.expenseDate } },
      });
      if (!periodExists) {
        throw new BadRequestException(
          'No open financial period covers this expense date. Create a financial period in Chart of Accounts first.',
        );
      }
    }

    // Create expense in transaction — if accounting is active, generate journal entry too
    const expense = await this.prisma.$transaction(async (tx) => {
      const exp = await tx.expense.create({
        data: {
          ...createExpenseDto,
          createdBy: userId ?? undefined,
          paymentMethod: createExpenseDto.paymentMethod ?? undefined,
          paymentAccountId: createExpenseDto.paymentAccountId ?? undefined,
        },
      });

      if (accountingEnabled && cat.accountId && createExpenseDto.paymentAccountId) {
        const je = await this.createExpenseJournalEntry(tx, {
          expenseId: exp.id,
          amount: createExpenseDto.amount,
          taxAmount: createExpenseDto.taxAmount ?? 0,
          expenseDate: createExpenseDto.expenseDate,
          description: createExpenseDto.description,
          expenseAccountId: cat.accountId,
          paymentAccountId: createExpenseDto.paymentAccountId,
          userId,
        });

        await tx.expense.update({
          where: { id: exp.id },
          data: { journalEntryId: je.id },
        });

        exp.journalEntryId = je.id;
      }

      return exp;
    });

    return this.prisma.expense.findUnique({
      where: { id: expense.id },
      include: this.expenseInclude,
    });
  }

  async findAll(page = 1, perPage = 10, categoryId?: string, fromDate?: string, toDate?: string) {
    const where: any = {};

    if (categoryId) where.categoryId = categoryId;
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

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { expenseDate: 'desc' },
        include: this.expenseInclude,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id },
      include: this.expenseInclude,
    });
    if (!expense) throw new NotFoundException(`Expense with ID ${id} not found`);
    return expense;
  }

  async update(id: string, updateExpenseDto: UpdateExpenseDto, userId?: string) {
    const existing = await this.findOne(id);

    if (updateExpenseDto.categoryId) {
      const cat = await this.prisma.expenseCategory.findUnique({ where: { id: updateExpenseDto.categoryId } });
      if (!cat) throw new NotFoundException(`Expense category ${updateExpenseDto.categoryId} not found`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.expense.update({ where: { id }, data: { ...updateExpenseDto, updatedBy: userId } });

      // If expense has a journal entry and amount or taxAmount changed, update it
      const amountChanged = updateExpenseDto.amount != null && Number(updateExpenseDto.amount) !== Number(existing.amount);
      const taxChanged = updateExpenseDto.taxAmount != null && Number(updateExpenseDto.taxAmount) !== Number(existing.taxAmount ?? 0);
      if (existing.journalEntryId && (amountChanged || taxChanged)) {
        const newAmount = Number(updateExpenseDto.amount ?? existing.amount);
        const newTaxAmount = Number(updateExpenseDto.taxAmount ?? existing.taxAmount ?? 0);
        const newTotal = newAmount + newTaxAmount;

        const cat = await tx.expenseCategory.findUnique({
          where: { id: updateExpenseDto.categoryId || existing.categoryId },
        });
        const paymentAccountId = updateExpenseDto.paymentAccountId || existing.paymentAccountId;

        if (cat?.accountId && paymentAccountId) {
          await tx.journalEntry.update({
            where: { id: existing.journalEntryId },
            data: {
              totalDebit: newTotal,
              totalCredit: newTotal,
              description: updateExpenseDto.description || existing.description,
              updatedAt: new Date(),
              updatedBy: userId,
            },
          });

          // Update journal lines
          const [drLine, crLine] = await tx.journalEntryLine.findMany({
            where: { entryId: existing.journalEntryId },
            orderBy: { createdAt: 'asc' },
          });

          if (drLine) {
            await tx.journalEntryLine.update({
              where: { id: drLine.id },
              data: { debit: newTotal, credit: 0 },
            });
          }
          if (crLine) {
            await tx.journalEntryLine.update({
              where: { id: crLine.id },
              data: { credit: newTotal, debit: 0 },
            });
          }
        }
      }
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    const expense = await this.findOne(id);

    await this.prisma.$transaction(async (tx) => {
      // Delete journal entry if exists (cascade handles lines)
      if (expense.journalEntryId) {
        await tx.expense.update({
          where: { id },
          data: { journalEntryId: null },
        });
        await tx.journalEntry.delete({ where: { id: expense.journalEntryId } });
      }

      await tx.expense.delete({ where: { id } });
    });

    return { deleted: true };
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
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    const catMap = new Map(categories.map(c => [c.id, { id: c.id, name: c.name, slug: c.slug, account: c.account }]));

    return grouped.map(g => ({
      category: catMap.get(g.categoryId) || { id: g.categoryId, name: g.categoryId.slice(0, 8), slug: 'unknown' },
      total: Number(g._sum.amount) || 0,
      count: g._count,
    }));
  }

  // ── Private helpers ──

  private async isAccountingEnabled(): Promise<boolean> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'accounting_enabled' } });
      return setting?.value === 'true';
    } catch {
      return false;
    }
  }

  private async createExpenseJournalEntry(
    tx: any,
    params: {
      expenseId: string;
      amount: number;
      taxAmount: number;
      expenseDate: Date;
      description: string;
      expenseAccountId: string;
      paymentAccountId: string;
      userId?: string;
    },
  ) {
    const { expenseId, amount, taxAmount, expenseDate, description, expenseAccountId, paymentAccountId, userId } = params;
    const totalAmount = amount + taxAmount;

    // Find financial period for expense date
    const period = await tx.financialPeriod.findFirst({
      where: {
        startDate: { lte: expenseDate },
        endDate: { gte: expenseDate },
      },
    });
    if (!period) {
      // No matching period — skip journal entry
      return null;
    }

    // Generate entry number
    const dateStr = `${String(expenseDate.getFullYear()).slice(2)}${String(expenseDate.getMonth() + 1).padStart(2, '0')}${String(expenseDate.getDate()).padStart(2, '0')}`;
    const counter = await tx.orderCounter.upsert({
      where: { date: dateStr },
      update: { seq: { increment: 1 } },
      create: { date: dateStr, seq: 1 },
    });
    const entryNo = `EXP-JE-${counter.date}-${String(counter.seq).padStart(4, '0')}`;

    return tx.journalEntry.create({
      data: {
        entryNo,
        periodId: period.id,
        entryDate: expenseDate,
        description: `Expense: ${description}`,
        totalDebit: totalAmount,
        totalCredit: totalAmount,
        referenceNo: expenseId,
        createdBy: userId,
        lines: {
          create: [
            {
              accountId: expenseAccountId,
              debit: totalAmount,
              credit: 0,
              description: description,
            },
            {
              accountId: paymentAccountId,
              debit: 0,
              credit: totalAmount,
              description: `Payment via account`,
            },
          ],
        },
      },
    });
  }
}
