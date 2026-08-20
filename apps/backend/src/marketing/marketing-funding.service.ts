import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import {
  CreateFundingDto,
  PostFundingDto,
} from './dto/marketing.dto';
import {
  MARKETING_EXPENSE_ACCOUNT_CODE,
  MARKETING_EXPENSE_ACCOUNT_NAME,
} from './marketing.constants';

@Injectable()
export class MarketingFundingService {
  private readonly logger = new Logger(MarketingFundingService.name);

  constructor(
    private prisma: PrismaService,
    private accounting: AccountingService,
  ) {}

  async addFunding(dto: CreateFundingDto, userId?: string) {
    const adAccount = await this.prisma.adAccount.findUnique({
      where: { id: dto.adAccountId },
    });
    if (!adAccount) throw new NotFoundException('Ad account not found');

    const currencyAmount = Math.round(dto.currencyAmount * 100) / 100;
    const eventuallyBaseAmount = dto.baseAmount;
    const computedBaseAmount =
      eventuallyBaseAmount ??
      Math.round(currencyAmount * (dto.effectiveRate ?? 0) * 100) / 100;
    const effectiveRate =
      dto.effectiveRate ??
      (computedBaseAmount > 0 ? computedBaseAmount / currencyAmount : 1);

    if (computedBaseAmount <= 0) {
      throw new BadRequestException(
        'baseAmount is required when currency is not the base currency',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.marketingFundingEntry.create({
        data: {
          platform: 'facebook',
          adAccountId: adAccount.id,
          fundingSource: dto.fundingSource,
          fundingDate: new Date(dto.fundingDate),
          currency: dto.currency ?? adAccount.currency,
          currencyAmount,
          baseCurrency: dto.baseCurrency ?? 'BDT',
          baseAmount: computedBaseAmount,
          effectiveRate,
          reference: dto.reference,
          remarks: dto.remarks,
          status: 'draft',
          createdBy: userId,
        },
      });

      await tx.marketingFundingLedger.create({
        data: {
          fundingEntryId: entry.id,
          adAccountId: adAccount.id,
          receivedAmount: currencyAmount,
          remainingAmount: currencyAmount,
          effectiveRate,
          consumedAmount: 0,
          status: 'confirmed',
        },
      });

      return entry;
    });
  }

  async list(page = 1, perPage = 20, adAccountId?: string) {
    const where: any = {};
    if (adAccountId) where.adAccountId = adAccountId;
    const [data, total] = await Promise.all([
      this.prisma.marketingFundingEntry.findMany({
        where,
        include: {
          adAccount: true,
          ledger: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ fundingDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.marketingFundingEntry.count({ where }),
    ]);
    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async summary() {
    const rows = await this.prisma.marketingFundingLedger.groupBy({
      by: ['adAccountId'],
      _sum: { remainingAmount: true, receivedAmount: true, consumedAmount: true },
    });
    const accounts = await this.prisma.adAccount.findMany();
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    return rows.map((r) => ({
      adAccountId: r.adAccountId,
      adAccountName: accountById.get(r.adAccountId)?.name ?? null,
      remainingAmount: Number(r._sum.remainingAmount ?? 0),
      receivedAmount: Number(r._sum.receivedAmount ?? 0),
      consumedAmount: Number(r._sum.consumedAmount ?? 0),
    }));
  }

  async confirm(id: string, userId?: string) {
    const entry = await this.prisma.marketingFundingEntry.findUnique({
      where: { id },
    });
    if (!entry) throw new NotFoundException('Funding entry not found');
    if (entry.status !== 'draft') {
      throw new ConflictException(`Cannot confirm entry in status "${entry.status}"`);
    }
    const updated = await this.prisma.marketingFundingEntry.update({
      where: { id },
      data: { status: 'confirmed' },
    });
    await this.audit('funding.confirm', id, userId);
    return updated;
  }

  /**
   * Post the confirmed funding to accounting: Dr Marketing Expenses /
   * Cr funding account, on the first open financial period containing the
   * funding date. Rejects closed periods (accounting rule) and preserves
   * double-entry totals.
   */
  async post(id: string, dto: PostFundingDto, userId?: string) {
    const entry = await this.prisma.marketingFundingEntry.findUnique({
      where: { id },
      include: { adAccount: true },
    });
    if (!entry) throw new NotFoundException('Funding entry not found');
    if (entry.status !== 'confirmed') {
      throw new ConflictException(
        `Cannot post entry in status "${entry.status}" (confirm it first)`,
      );
    }
    if (entry.journalEntryId) {
      throw new ConflictException('Entry is already posted to accounting');
    }

    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        startDate: { lte: entry.fundingDate },
        endDate: { gte: entry.fundingDate },
      },
      orderBy: { startDate: 'desc' },
    });
    if (!period) {
      throw new BadRequestException(
        'No open-or-past financial period covers the funding date',
      );
    }
    if (period.isClosed) {
      throw new BadRequestException(
        'Financial period is closed — funding cannot be posted',
      );
    }

    const marketingAccount = await this.ensureMarketingExpenseAccount();
    const fundingAccount = await this.prisma.account.findUnique({
      where: { id: dto.fundingAccountId },
    });
    if (!fundingAccount) throw new NotFoundException('Funding account not found');
    if (fundingAccount.isGroup) {
      throw new BadRequestException(
        `Account "${fundingAccount.name}" is a group account and cannot be posted to`,
      );
    }

    const journalEntry = await this.accounting.createEntry(
      {
        periodId: period.id,
        entryDate: entry.fundingDate.toISOString(),
        description: `Marketing funding — ${entry.adAccount.name}${entry.reference ? ` (${entry.reference})` : ''}`,
        referenceNo: `FUND-${entry.id.slice(0, 8)}`,
        lines: [
          {
            accountId: marketingAccount.id,
            debit: Number(entry.baseAmount),
            credit: 0,
            description: 'Marketing ad spend funding',
          },
          {
            accountId: fundingAccount.id,
            debit: 0,
            credit: Number(entry.baseAmount),
            description: 'Funding source',
          },
        ],
      },
      userId,
    );

    const updated = await this.prisma.marketingFundingEntry.update({
      where: { id },
      data: {
        journalEntryId: journalEntry.id,
        status: 'posted',
        postedAt: new Date(),
      },
    });
    await this.audit('funding.post', id, userId, { entryNo: journalEntry.entryNo });
    return { ...updated, journalEntry };
  }

  async archive(id: string, userId?: string) {
    const entry = await this.prisma.marketingFundingEntry.findUnique({
      where: { id },
      include: { ledger: true },
    });
    if (!entry) throw new NotFoundException('Funding entry not found');
    const remaining = entry.ledger.reduce(
      (sum, l) => sum + Number(l.remainingAmount),
      0,
    );
    if (remaining > 0.0001) {
      throw new ConflictException(
        'Entry still has unconsumed funds — archive after it is fully consumed',
      );
    }
    const updated = await this.prisma.marketingFundingEntry.update({
      where: { id },
      data: { status: 'archived' },
    });
    await this.audit('funding.archive', id, userId);
    return updated;
  }

  async remove(id: string, userId?: string) {
    const entry = await this.prisma.marketingFundingEntry.findUnique({
      where: { id },
    });
    if (!entry) throw new NotFoundException('Funding entry not found');
    if (entry.status !== 'draft') {
      throw new ConflictException(
        'Only draft funding entries can be deleted',
      );
    }
    await this.prisma.marketingFundingLedger.deleteMany({
      where: { fundingEntryId: id },
    });
    await this.prisma.marketingFundingEntry.delete({ where: { id } });
    await this.audit('funding.delete', id, userId);
    return { success: true };
  }

  private async ensureMarketingExpenseAccount() {
    const account = await this.prisma.account.findFirst({
      where: { code: MARKETING_EXPENSE_ACCOUNT_CODE },
    });
    if (account) return account;
    const created = await this.prisma.account.create({
      data: {
        code: MARKETING_EXPENSE_ACCOUNT_CODE,
        name: MARKETING_EXPENSE_ACCOUNT_NAME,
        type: 'expense',
        isGroup: false,
      },
    });
    this.logger.log(
      `Created marketing expense account ${created.code} (${created.id})`,
    );
    return created;
  }

  private async audit(action: string, entityId: string, actorId?: string, metadata?: any) {
    await this.prisma.marketingAuditLog.create({
      data: {
        action,
        entityType: 'funding',
        entityId,
        actorId,
        metadata: metadata ?? {},
      },
    });
  }
}