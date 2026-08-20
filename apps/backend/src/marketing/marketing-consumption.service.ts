import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketingConsumptionService {
  private readonly logger = new Logger(MarketingConsumptionService.name);

  constructor(private prisma: PrismaService) {}

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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
          await tx.marketingConsumption.create({
            data: {
              ledgerId: row.id,
              campaignId,
              consumedAmount: take,
              effectiveRate: Number(row.effectiveRate),
              calculatedCost: Math.round(take * Number(row.effectiveRate) * 100) / 100,
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
}