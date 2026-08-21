import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { AccountType } from '@prisma/client';
import {
  MARKETING_EXPENSE_ACCOUNT_CODE,
  MARKETING_EXPENSE_ACCOUNT_NAME,
  MARKETING_PREPAID_ACCOUNT_CODE,
  MARKETING_PREPAID_ACCOUNT_NAME,
} from './marketing.constants';

@Injectable()
export class MarketingConsumptionService {
  private readonly logger = new Logger(MarketingConsumptionService.name);

  constructor(
    private prisma: PrismaService,
    private accounting: AccountingService,
  ) {}

  /**
   * FIFO consumption: spend is drawn from the oldest confirmed funding rows
   * first. Each consumption records the effectiveRate captured at draw time so
   * later rate changes never rewrite historical cost (deterministic).
   *
   * @returns rows consumed + shortfall (spend that could not be funded)
   */
  async consume(
    campaignId: string,
    amount: number,
    source = 'spend_sync',
    spendDate?: Date,
  ): Promise<{ consumedRows: number; shortfall: number }> {
    if (amount <= 0) return { consumedRows: 0, shortfall: 0 };

    const campaign = await this.prisma.marketingCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw new BadRequestException('Campaign not found');

    const ledgerRows = await this.prisma.marketingFundingLedger.findMany({
      where: {
        adAccountId: campaign.adAccountId,
        status: { in: ['confirmed', 'partially_consumed'] },
        remainingAmount: { gt: 0 },
      },
      orderBy: [
        // Promotional credit consumed FIRST (platform standard: use-it-or-lose-it)
        { fundingType: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    let remaining = amount;
    let consumedRows = 0;

    for (const row of ledgerRows) {
      if (remaining <= 0) break;
      const take = Number(row.remainingAmount) >= remaining ? remaining : Number(row.remainingAmount);
      if (take <= 0) continue;

      try {
        await this.prisma.$transaction(async (tx) => {
          const current = await tx.marketingFundingLedger.findUnique({
            where: { id: row.id },
          });
          if (!current || Number(current.remainingAmount) < take - 1e-9) {
            throw new Error('stale_ledger');
          }
          const calculatedCost = Math.round(take * Number(row.effectiveRate) * 100) / 100;
          await tx.marketingConsumption.create({
            data: {
              ledgerId: row.id,
              campaignId,
              consumedAmount: take,
              effectiveRate: Number(row.effectiveRate),
              calculatedCost,
              spendDate: spendDate ?? null,
              source,
            },
          });
          await tx.marketingFundingLedger.update({
            where: { id: row.id },
            data: {
              remainingAmount: Number(current.remainingAmount) - take,
              consumedAmount: Number(current.consumedAmount) + take,
              status: Number(current.remainingAmount) - take < 1e-9 ? 'fully_consumed' : 'partially_consumed',
            },
          });

          // Accrual journal: Dr Marketing Expense / Cr Marketing Prepaid
          // ONLY for paid credit — promotional credit has no cash outflow
          if (calculatedCost > 0 && row.fundingType !== 'promotional') {
            await this.createConsumptionJournal(
              calculatedCost,
              spendDate ?? new Date(),
              campaignId,
            );
          }
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'stale_ledger') {
          continue;
        }
        throw err;
      }

      remaining = Math.max(0, Math.round((remaining - take) * 10000) / 10000);
      consumedRows++;
    }

    return { consumedRows, shortfall: Math.round(remaining * 10000) / 10000 };
  }

  /**
   * Consume spend for every (campaign, date) with spend > 0 after an insights
   * sync. Shortfall (unfunded spend) is logged, never fails the sync.
   */
  async consumeInsightSpend(
    entries: Array<{ campaignId: string; spend: number; date: Date }>,
  ) {
    for (const entry of entries) {
      try {
        const { shortfall } = await this.consume(
          entry.campaignId,
          entry.spend,
          'spend_sync',
          entry.date,
        );
        if (shortfall > 0.0001) {
          this.logger.warn(
            `Unfunded marketing spend: campaign ${entry.campaignId} BDT/CUR ${shortfall} on ${entry.date.toISOString().slice(0, 10)}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Consumption failed for campaign ${entry.campaignId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  async totalConsumed(adAccountId?: string) {
    return this.prisma.marketingConsumption.aggregate({
      _sum: { consumedAmount: true, calculatedCost: true },
      where: adAccountId
        ? { ledger: { adAccountId } }
        : undefined,
    });
  }

  /**
   * Accrual journal entry: Dr Marketing Expense / Cr Marketing Prepaid.
   * Created at spend/consumption time, NOT at deposit time.
   */
  private async createConsumptionJournal(
    amount: number,
    spendDate: Date,
    campaignId: string,
  ) {
    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        startDate: { lte: spendDate },
        endDate: { gte: spendDate },
      },
      orderBy: { startDate: 'desc' },
    });
    if (!period || period.isClosed) {
      this.logger.warn(
        `No open period for consumption journal on ${spendDate.toISOString().slice(0, 10)} — skipping`,
      );
      return;
    }

    const expenseAccount = await this.ensureAccount(
      MARKETING_EXPENSE_ACCOUNT_CODE,
      MARKETING_EXPENSE_ACCOUNT_NAME,
      'expense',
    );
    const prepaidAccount = await this.ensureAccount(
      MARKETING_PREPAID_ACCOUNT_CODE,
      MARKETING_PREPAID_ACCOUNT_NAME,
      'asset',
    );

    await this.accounting.createEntry(
      {
        periodId: period.id,
        entryDate: spendDate.toISOString(),
        description: `Marketing consumption — campaign ${campaignId}`,
        referenceNo: `MCON-${campaignId.slice(0, 8)}-${spendDate.toISOString().slice(0, 10)}`,
        lines: [
          {
            accountId: expenseAccount.id,
            debit: amount,
            credit: 0,
            description: 'Marketing expense recognized at spend time',
          },
          {
            accountId: prepaidAccount.id,
            debit: 0,
            credit: amount,
            description: 'Marketing prepaid credit consumed',
          },
        ],
      },
      undefined,
    );
  }

  private async ensureAccount(code: string, name: string, type: AccountType) {
    const existing = await this.prisma.account.findFirst({ where: { code } });
    if (existing) return existing;
    return this.prisma.account.create({
      data: { code, name, type, isGroup: false },
    });
  }
}