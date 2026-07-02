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

    if (totalDebit !== totalCredit) {
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

    for (const line of dto.lines) {
      const account = await this.prisma.account.findUnique({
        where: { id: line.accountId },
      });
      if (!account) {
        throw new NotFoundException(
          `Account with ID ${line.accountId} not found`,
        );
      }
    }

    const date = new Date(dto.entryDate);
    const dateStr = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

    const counter = await this.prisma.orderCounter.upsert({
      where: { date: dateStr },
      update: { seq: { increment: 1 } },
      create: { date: dateStr, seq: 1 },
    });

    const entryNo = `JE-${counter.date}-${String(counter.seq).padStart(4, '0')}`;

    return this.prisma.journalEntry.create({
      data: {
        entryNo,
        periodId: dto.periodId,
        entryDate: date,
        description: dto.description,
        totalDebit,
        totalCredit,
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

    return this.prisma.journalEntry.delete({ where: { id } });
  }

  async trialBalance(periodId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.type, a.id as account_id, a.code as account_code, a.name as account_name,
              COALESCE(SUM(jel.debit), 0) as total_debit,
              COALESCE(SUM(jel.credit), 0) as total_credit
       FROM "Account" a
       LEFT JOIN "JournalEntryLine" jel ON jel."accountId" = a.id
       LEFT JOIN "JournalEntry" je ON je.id = jel."entryId" AND je."periodId" = $1
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
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.type, a.id as account_id, a.code as account_code, a.name as account_name,
              COALESCE(SUM(jel.debit - jel.credit), 0) as balance
       FROM "Account" a
       LEFT JOIN "JournalEntryLine" jel ON jel."accountId" = a.id
       LEFT JOIN "JournalEntry" je ON je.id = jel."entryId" AND je."periodId" = $1
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
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.type, a.id as account_id, a.code as account_code, a.name as account_name,
              COALESCE(SUM(jel.debit - jel.credit), 0) as balance
       FROM "Account" a
       LEFT JOIN "JournalEntryLine" jel ON jel."accountId" = a.id
       LEFT JOIN "JournalEntry" je ON je.id = jel."entryId" AND je."periodId" = $1
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
