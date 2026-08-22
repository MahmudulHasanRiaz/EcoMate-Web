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
  MarketingPaymentStatus,
  Prisma,
} from '@prisma/client';
import {
  MARKETING_EXPENSE_ACCOUNT_CODE,
  MARKETING_EXPENSE_ACCOUNT_NAME,
  MARKETING_PREPAID_ACCOUNT_CODE,
  MARKETING_PREPAID_ACCOUNT_NAME,
  MARKETING_PAYABLE_ACCOUNT_CODE,
  MARKETING_PAYABLE_ACCOUNT_NAME,
} from './marketing.constants';

export interface CreatePaymentDto {
  adAccountId: string;
  providerPaymentId?: string;
  platformAmount: number;
  platformCurrency?: string;
  paymentDate: string;
  notes?: string;
  sourceAccountId?: string;
}

export interface ReconcilePaymentDto {
  actualCost: number;
  baseCurrency?: string;
  feeAmount?: number;
  taxAmount?: number;
  processingFee?: number;
}

@Injectable()
export class MarketingPaymentService {
  private readonly logger = new Logger(MarketingPaymentService.name);

  constructor(
    private prisma: PrismaService,
    private accounting: AccountingService,
  ) {}

  /**
   * Simple mode: record a payment with just platform amount + actual BDT cost.
   * The effective rate is derived automatically.
   */
  async createPayment(dto: CreatePaymentDto, userId?: string) {
    const adAccount = await this.prisma.adAccount.findUnique({
      where: { id: dto.adAccountId },
    });
    if (!adAccount) throw new NotFoundException('Ad account not found');

    if (dto.providerPaymentId) {
      const existing = await this.prisma.marketingPayment.findUnique({
        where: { providerPaymentId: dto.providerPaymentId },
      });
      if (existing) {
        throw new ConflictException(
          `Payment with provider ID "${dto.providerPaymentId}" already exists`,
        );
      }
    }

    return this.prisma.marketingPayment.create({
      data: {
        adAccountId: dto.adAccountId,
        providerPaymentId: dto.providerPaymentId,
        platformAmount: dto.platformAmount,
        platformCurrency: dto.platformCurrency ?? adAccount.currency,
        paymentDate: new Date(dto.paymentDate),
        notes: dto.notes,
        sourceAccountId: dto.sourceAccountId ?? adAccount.defaultPaymentAccountId,
        status: 'pending',
      },
      include: { adAccount: true },
    });
  }

  /**
   * Simple reconcile: user enters actual BDT cost, system derives FX rate.
   */
  async reconcileSimple(id: string, dto: ReconcilePaymentDto, userId?: string) {
    const payment = await this.prisma.marketingPayment.findUnique({
      where: { id },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'reconciled') {
      throw new ConflictException('Payment is already reconciled');
    }

    const actualCost = dto.actualCost;
    const platformAmount = Number(payment.platformAmount);
    if (platformAmount <= 0) {
      throw new BadRequestException('Platform amount must be positive');
    }

    const effectiveRate = Math.round((actualCost / platformAmount) * 10000) / 10000;

    return this.prisma.marketingPayment.update({
      where: { id },
      data: {
        actualCost,
        baseCurrency: dto.baseCurrency ?? 'BDT',
        effectiveRate,
        feeAmount: dto.feeAmount ?? null,
        taxAmount: dto.taxAmount ?? null,
        processingFee: dto.processingFee ?? null,
        status: 'reconciled',
        reconciledAt: new Date(),
      },
      include: { adAccount: true },
    });
  }

  /**
   * Advanced reconcile: user provides full breakdown (fee/tax/processing).
   */
  async reconcileAdvanced(id: string, dto: ReconcilePaymentDto, userId?: string) {
    return this.reconcileSimple(id, dto, userId);
  }

  /**
   * Post reconciled payment to accounting.
   * Dr Marketing Payable / Cr Payment Source Account.
   * Marketing Prepaid is NEVER touched by threshold payments.
   */
  async postToAccounting(id: string, userId?: string) {
    const payment = await this.prisma.marketingPayment.findUnique({
      where: { id },
      include: { adAccount: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'reconciled') {
      throw new ConflictException('Payment must be reconciled before posting');
    }
    if (payment.journalEntryId) {
      throw new ConflictException('Payment is already posted to accounting');
    }
    if (!payment.actualCost || Number(payment.actualCost) <= 0) {
      throw new BadRequestException('Actual cost must be set before posting');
    }

    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        startDate: { lte: payment.paymentDate },
        endDate: { gte: payment.paymentDate },
      },
      orderBy: { startDate: 'desc' },
    });
    if (!period) {
      throw new BadRequestException(
        'No open financial period covers the payment date',
      );
    }
    if (period.isClosed) {
      throw new BadRequestException('Financial period is closed');
    }

    const marketingPayable = await this.ensureMarketingPayableAccount();
    const sourceAccount = payment.sourceAccountId
      ? await this.prisma.account.findUnique({ where: { id: payment.sourceAccountId } })
      : null;
    if (!sourceAccount) {
      throw new BadRequestException(
        'Source payment account is required for posting',
      );
    }
    if (sourceAccount.isGroup) {
      throw new BadRequestException(
        `Account "${sourceAccount.name}" is a group account and cannot be posted to`,
      );
    }

    const amount = Number(payment.actualCost);

    const journalEntry = await this.accounting.createEntry(
      {
        periodId: period.id,
        entryDate: payment.paymentDate.toISOString(),
        description: `Marketing threshold payment — ${payment.adAccount.name}${payment.notes ? ` (${payment.notes})` : ''}`,
        referenceNo: `MPAY-${payment.id.slice(0, 8)}`,
        lines: [
          {
            accountId: marketingPayable.id,
            debit: amount,
            credit: 0,
            description: 'Marketing payable reduction',
          },
          {
            accountId: sourceAccount.id,
            debit: 0,
            credit: amount,
            description: 'Payment source',
          },
        ],
      },
      userId,
    );

    const updated = await this.prisma.marketingPayment.update({
      where: { id },
      data: {
        journalEntryId: journalEntry.id,
        status: 'reconciled',
      },
    });

    return { ...updated, journalEntry };
  }

  async list(page = 1, perPage = 20, adAccountId?: string, status?: MarketingPaymentStatus) {
    const where: any = {};
    if (adAccountId) where.adAccountId = adAccountId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.marketingPayment.findMany({
        where,
        include: { adAccount: true, sourceAccount: true, journalEntry: true },
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.marketingPayment.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async getById(id: string) {
    const payment = await this.prisma.marketingPayment.findUnique({
      where: { id },
      include: { adAccount: true, sourceAccount: true, journalEntry: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /**
   * Credit/Due position per ad account.
   *
   * Credit = remaining prepaid (paid + promotional) in platform currency.
   * Due    = Marketing Payable net credit balance (threshold created − threshold paid).
   * Net    = value of remaining prepaid − due.
   *
   * Lot-based valuation: remaining prepaid credit is valued from actual
   * remaining ledger lots, not the first lot's effective rate.
   */
  async creditDuePosition(adAccountId?: string) {
    const accounts = await this.prisma.adAccount.findMany({
      where: adAccountId ? { id: adAccountId } : {},
      include: {
        fundingLedger: true,
        payments: true,
      },
    });

    const accountIds = accounts.map((a) => a.id);

    // Build campaignId → adAccountId map for payable scoping
    const campaigns = await this.prisma.marketingCampaign.findMany({
      where: { adAccountId: { in: accountIds } },
      select: { id: true, adAccountId: true },
    });
    const campaignToAccount = new Map(campaigns.map((c) => [c.id, c.adAccountId]));

    // Get the Marketing Payable balance scoped per ad account.
    //
    // Threshold journals: entry description = "Marketing threshold (unfunded) — campaign <campaignId>"
    //   → credit line on payable account; campaignId links to adAccountId.
    //
    // Payment debits: from MarketingPayment table (has adAccountId directly).
    //   Journal debit lines do NOT carry campaign info — so we use the payment
    //   table instead, which already links to the ad account.
    //
    // Due per account = threshold credits (journal) − payments (MarketingPayment table).
    const payableAccount = await this.prisma.account.findFirst({
      where: { code: MARKETING_PAYABLE_ACCOUNT_CODE },
    });
    const dueByAccount = new Map<string, number>();
    if (payableAccount) {
      // Step 1: Get all threshold journal credits scoped to campaigns of these accounts
      const payableLines = await this.prisma.journalEntryLine.findMany({
        where: { accountId: payableAccount.id, credit: { gt: 0 } },
        select: { credit: true, entry: { select: { description: true } } },
      });
      for (const line of payableLines) {
        const entryDesc = line.entry?.description ?? '';
        const campaignMatch = entryDesc.match(/campaign\s+([0-9a-f-]{36})/i);
        if (campaignMatch) {
          const campaignId = campaignMatch[1];
          const accountId = campaignToAccount.get(campaignId);
          if (accountId) {
            dueByAccount.set(accountId, (dueByAccount.get(accountId) ?? 0) + Number(line.credit));
          }
        }
      }
    }

    // Step 2: Subtract payments (reconciled, from MarketingPayment table)
    const allPayments = await this.prisma.marketingPayment.findMany({
      where: { status: 'reconciled', actualCost: { gt: 0 } },
      select: { adAccountId: true, actualCost: true },
    });
    const paymentsByAccount = new Map<string, number>();
    for (const p of allPayments) {
      paymentsByAccount.set(p.adAccountId, (paymentsByAccount.get(p.adAccountId) ?? 0) + Number(p.actualCost));
      // Subtract payment from due
      dueByAccount.set(p.adAccountId, (dueByAccount.get(p.adAccountId) ?? 0) - Number(p.actualCost));
    }

    return accounts.map((account) => {
      // Split by funding type
      const paidLedger = account.fundingLedger.filter((l) => l.fundingType === 'paid');
      const promoLedger = account.fundingLedger.filter((l) => l.fundingType === 'promotional');

      const paidFunded = paidLedger.reduce((sum, l) => sum + Number(l.receivedAmount), 0);
      const paidConsumed = paidLedger.reduce((sum, l) => sum + Number(l.consumedAmount), 0);
      const promoFunded = promoLedger.reduce((sum, l) => sum + Number(l.receivedAmount), 0);
      const promoConsumed = promoLedger.reduce((sum, l) => sum + Number(l.consumedAmount), 0);

      // Credits in platform currency
      const paidCredit = Math.round((paidFunded - paidConsumed) * 100) / 100;
      const promotionalCredit = Math.round((promoFunded - promoConsumed) * 100) / 100;
      const totalCredit = Math.round((paidCredit + promotionalCredit) * 100) / 100;

      // Due = Marketing Payable net credit balance scoped to this account's campaigns.
      // Threshold journals (credit) increase due; threshold payments (debit) decrease due.
      const totalPaid = paymentsByAccount.get(account.id) ?? 0;
      const accountPayable = dueByAccount.get(account.id) ?? 0;
      const due = Math.round(accountPayable * 100) / 100;

      // Billed = due + totalPaid (reconstruct for backward compat display)
      const billed = Math.round((due + totalPaid) * 100) / 100;

      // Net position (base currency): lot-based credit value minus due.
      const creditValue = paidLedger
        .filter((l) => Number(l.remainingAmount) > 0)
        .reduce((sum, l) => sum + Number(l.remainingAmount) * Number(l.effectiveRate), 0);
      const netPosition = Math.round((creditValue - due) * 100) / 100;

      return {
        adAccountId: account.id,
        adAccountName: account.name,
        currency: account.currency,
        // Breakdown by type
        paidFunded,
        paidConsumed,
        paidCredit,
        promoFunded,
        promoConsumed,
        promotionalCredit,
        // Totals
        totalFunded: paidFunded + promoFunded,
        totalConsumed: paidConsumed + promoConsumed,
        totalCredit,
        // Due (base currency) — from Marketing Payable balance scoped per account
        totalPaid,
        billed,
        due,
        netPosition,
      };
    });
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

  private async ensureMarketingPrepaidAccount() {
    const account = await this.prisma.account.findFirst({
      where: { code: MARKETING_PREPAID_ACCOUNT_CODE },
    });
    if (account) return account;
    const created = await this.prisma.account.create({
      data: {
        code: MARKETING_PREPAID_ACCOUNT_CODE,
        name: MARKETING_PREPAID_ACCOUNT_NAME,
        type: 'asset',
        isGroup: false,
      },
    });
    this.logger.log(
      `Created marketing prepaid account ${created.code} (${created.id})`,
    );
    return created;
  }

  private async ensureMarketingPayableAccount() {
    const account = await this.prisma.account.findFirst({
      where: { code: MARKETING_PAYABLE_ACCOUNT_CODE },
    });
    if (account) return account;
    const created = await this.prisma.account.create({
      data: {
        code: MARKETING_PAYABLE_ACCOUNT_CODE,
        name: MARKETING_PAYABLE_ACCOUNT_NAME,
        type: 'liability',
        isGroup: false,
      },
    });
    this.logger.log(
      `Created marketing payable account ${created.code} (${created.id})`,
    );
    return created;
  }
}
