import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';

@Injectable()
export class AccountingService {
  constructor(private prisma: PrismaService) {}

  async createEntry(dto: CreateJournalEntryDto, userId?: string) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException(
        'Journal entry must have at least one line',
      );
    }

    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of dto.lines) {
      if (line.debit > 0 && line.credit > 0) {
        throw new BadRequestException('Line cannot have both debit and credit');
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new BadRequestException('Line must have either debit or credit');
      }
      totalDebit += line.debit;
      totalCredit += line.credit;
    }

    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
      throw new BadRequestException('Total debit must equal total credit');
    }

    const period = await this.prisma.financialPeriod.findUnique({
      where: { id: dto.periodId },
    });
    if (!period) {
      throw new NotFoundException(
        `Financial period with ID ${dto.periodId} not found`,
      );
    }
    if (period.isClosed) {
      throw new BadRequestException(
        'Cannot post entry to a closed financial period',
      );
    }

    const accountIds = dto.lines.map((l) => l.accountId);
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
    });
    const foundIds = new Set(accounts.map((a) => a.id));
    for (const accountId of accountIds) {
      if (!foundIds.has(accountId)) {
        throw new NotFoundException(`Account with ID ${accountId} not found`);
      }
    }
    const groupAccount = accounts.find((a) => a.isGroup);
    if (groupAccount) {
      throw new BadRequestException(
        `Account "${groupAccount.name}" (${groupAccount.code}) is a group account and cannot be posted to directly`,
      );
    }

    const date = new Date(dto.entryDate);
    if (date < period.startDate || date > period.endDate) {
      throw new BadRequestException(
        'Entry date must be within the financial period',
      );
    }

    const dateStr = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: dateStr },
        update: { seq: { increment: 1 } },
        create: { date: dateStr, seq: 1 },
      });

      const entryNo = `JE-${counter.date}-${String(counter.seq).padStart(4, '0')}`;

      return tx.journalEntry.create({
        data: {
          entryNo,
          periodId: dto.periodId,
          entryDate: date,
          description: dto.description,
          totalDebit: Math.round(totalDebit * 100) / 100,
          totalCredit: Math.round(totalCredit * 100) / 100,
          referenceNo: dto.referenceNo,
          createdBy: userId,
          lines: {
            create: dto.lines.map((line) => ({
              accountId: line.accountId,
              debit: line.debit,
              credit: line.credit,
              description: line.description,
            })),
          },
        },
        include: {
          lines: { include: { account: true } },
          period: true,
        },
      });
    });
  }

  async findAllEntries(page: number, perPage: number, periodId?: string) {
    const where: any = {};
    if (periodId) where.periodId = periodId;

    const [data, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: { include: { account: true } },
          period: true,
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async getEntry(id: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: { include: { account: true } },
        period: true,
      },
    });
    if (!entry)
      throw new NotFoundException(`Journal entry with ID ${id} not found`);
    return entry;
  }

  async deleteEntry(id: string) {
    const entry = await this.prisma.journalEntry.findUnique({ where: { id } });
    if (!entry)
      throw new NotFoundException(`Journal entry with ID ${id} not found`);

    // Check if linked to an expense
    const linkedExpense = await this.prisma.expense.findUnique({
      where: { journalEntryId: id },
    });
    if (linkedExpense) {
      throw new BadRequestException(
        `Cannot delete journal entry linked to expense "${linkedExpense.description.slice(0, 50)}". Delete the expense first.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      return tx.journalEntry.delete({ where: { id } });
    });
  }

  async trialBalance(periodId: string) {
    // Raw SQL needed: multi-table LEFT JOIN with conditional aggregation (SUM + CASE inside
    // COALESCE) filtered by periodId. Prisma's query builder cannot express SUM with
    // conditional CASE WHEN across joined relations; this avoids fetching all lines and
    // aggregating in application memory, which would be O(n) per account.
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.type, a.id as account_id, a.code as account_code, a.name as account_name,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je."periodId" = $1 THEN jel.debit ELSE 0 END), 0) as total_debit,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je."periodId" = $1 THEN jel.credit ELSE 0 END), 0) as total_credit
       FROM "Account" a
       LEFT JOIN "JournalEntryLine" jel ON jel."accountId" = a.id
       LEFT JOIN "JournalEntry" je ON je.id = jel."entryId"
       WHERE a."isActive" = true
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      periodId,
    );

    const accounts = rows.map((row: any) => ({
      ...row,
      total_debit: Number(row.total_debit),
      total_credit: Number(row.total_credit),
    }));

    const totalDebit = accounts.reduce(
      (sum: number, a: any) => sum + a.total_debit,
      0,
    );
    const totalCredit = accounts.reduce(
      (sum: number, a: any) => sum + a.total_credit,
      0,
    );

    return { accounts, totalDebit, totalCredit };
  }

  async profitAndLoss(periodId: string) {
    // Raw SQL needed: same multi-table LEFT JOIN pattern as trialBalance, also filtering
    // account types (income/expense only). Prisma cannot express the CASE-wrapped
    // debit-credit difference per line across a polymorphic period filter.
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.type, a.id as account_id, a.code as account_code, a.name as account_name,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je."periodId" = $1 THEN jel.debit - jel.credit ELSE 0 END), 0) as balance
       FROM "Account" a
       LEFT JOIN "JournalEntryLine" jel ON jel."accountId" = a.id
       LEFT JOIN "JournalEntry" je ON je.id = jel."entryId"
       WHERE a.type IN ('income', 'expense') AND a."isActive" = true
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      periodId,
    );

    const incomeAccounts: any[] = [];
    const expenseAccounts: any[] = [];
    let totalIncome = 0;
    let totalExpense = 0;

    for (const row of rows) {
      const balance = Number(row.balance);
      const entry = { ...row, balance };
      if (row.type === 'income') {
        incomeAccounts.push(entry);
        totalIncome += Math.abs(balance);
      } else if (row.type === 'expense') {
        expenseAccounts.push(entry);
        totalExpense += Math.abs(balance);
      }
    }

    return {
      incomeAccounts,
      expenseAccounts,
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
    };
  }

  async balanceSheet(periodId: string) {
    // Raw SQL needed: same multi-table LEFT JOIN / conditional aggregation pattern, filtering
    // to balance-sheet account types (asset/liability/equity). Prisma cannot express
    // COALESCE(SUM(CASE ...)) across joined relations in a single query.
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.type, a.id as account_id, a.code as account_code, a.name as account_name,
              COALESCE(SUM(CASE WHEN je.id IS NOT NULL AND je."periodId" = $1 THEN jel.debit - jel.credit ELSE 0 END), 0) as balance
       FROM "Account" a
       LEFT JOIN "JournalEntryLine" jel ON jel."accountId" = a.id
       LEFT JOIN "JournalEntry" je ON je.id = jel."entryId"
       WHERE a.type IN ('asset', 'liability', 'equity') AND a."isActive" = true
       GROUP BY a.id, a.code, a.name, a.type
       ORDER BY a.code`,
      periodId,
    );

    const assetAccounts: any[] = [];
    const liabilityAccounts: any[] = [];
    const equityAccounts: any[] = [];
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const row of rows) {
      const balance = Number(row.balance);
      const absBalance = Math.abs(balance);
      const entry = { ...row, balance };
      if (row.type === 'asset') {
        assetAccounts.push(entry);
        totalAssets += absBalance;
      } else if (row.type === 'liability') {
        liabilityAccounts.push(entry);
        totalLiabilities += absBalance;
      } else if (row.type === 'equity') {
        equityAccounts.push(entry);
        totalEquity += absBalance;
      }
    }

    return {
      assetAccounts,
      liabilityAccounts,
      equityAccounts,
      totalAssets,
      totalLiabilities,
      totalEquity,
    };
  }

  async accountLedger(accountId: string, periodId?: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account)
      throw new NotFoundException(`Account with ID ${accountId} not found`);

    const where: any = { accountId };
    if (periodId) {
      where.entry = { periodId };
    }

    const lines = await this.prisma.journalEntryLine.findMany({
      where,
      include: {
        entry: {
          select: { entryNo: true, entryDate: true, description: true },
        },
      },
      orderBy: { entry: { entryDate: 'asc' } },
    });

    const entries = lines.map((line: any) => ({
      ...line,
      debit: Number(line.debit),
      credit: Number(line.credit),
    }));

    const totalDebit = entries.reduce(
      (sum: number, e: any) => sum + e.debit,
      0,
    );
    const totalCredit = entries.reduce(
      (sum: number, e: any) => sum + e.credit,
      0,
    );

    return { account, entries, totalDebit, totalCredit };
  }
}
