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
   * Due    = threshold consumption (base currency) − reconciled payments (base currency).
   *           Only threshold/unfunded spend creates a payable.
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

      // Due: only threshold consumption (unfunded spend) creates a payable.
      // Threshold amount = total spent − amount consumed from paid ledger − amount consumed from promo ledger.
      // We compute this via: total paid consumption rate sum − paid consumption (already billed) − promo consumption.
      // Simpler: due = all paid ledger consumption * rate − reconciled payments (already recorded as payable).
      // Even simpler: due = total billed − total paid. Total billed = sum(paidConsumed * effectiveRate) for paid only.
      const billed = paidLedger.reduce(
        (sum, l) => sum + Number(l.consumedAmount) * Number(l.effectiveRate),
        0,
      );
      const totalPaid = account.payments
        .filter((p) => p.status === 'reconciled' && p.actualCost)
        .reduce((sum, p) => sum + Number(p.actualCost), 0);
      const due = Math.round((billed - totalPaid) * 100) / 100;

      // Net position (base currency): lot-based credit value minus due.
      // Credit value = sum of (remaining × effectiveRate) across all remaining ledger lots.
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
        // Due (base currency) — threshold-only
        totalPaid,
        billed: Math.round(billed * 100) / 100,
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
