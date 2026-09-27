// ── Courier Settlement ↔ Accounting bridge (PRD §4, §5, §8.2, §16).
//
// Finalization posts ONE balanced journal (J1) and links it to the invoice.
// Corrections post compensating journals (J2..Jn) built from declared deltas.
// A J1 that already exists is adopted, never duplicated (repair idempotency).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { CourierSettlementSettingsService } from './courier-settlement-settings.service';
import {
  buildFinalizationEntry,
  buildCorrectionEntry,
  type Counterpart,
} from './accounting/courier-accounting';
import { dhakaDateParts } from '../common/utils/dhaka-time';

export interface PostFinalizationInput {
  invoiceId: string;
  gross: number;
  charges: number;
  net: number;
  entryDate: Date;
  referenceNo: string;
  description: string;
  actor?: string | null;
}

export interface PostCorrectionInput {
  invoiceId: string;
  deltaG: number;
  deltaC: number;
  deltaN: number;
  counterpart?: Counterpart | null;
  entryDate: Date;
  referenceNo: string;
  description: string;
  actor?: string | null;
}

export interface AccountingPostResult {
  journalEntryId: string;
  adopted: boolean;
}

/** Raised when accounting cannot post (no open period, unbalanced, etc.). */
export class AccountingPostError extends Error {}

@Injectable()
export class CourierSettlementAccountingService {
  private readonly logger = new Logger(CourierSettlementAccountingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly settings: CourierSettlementSettingsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    return this.settings.isAccountingEnabled();
  }

  /**
   * Post the finalization entry (J1). Idempotent: if the invoice already has a
   * linked journal, it is adopted. Caller must already have set
   * `journalEntryId` to null before calling so the unique constraint is free.
   */
  async postFinalization(input: PostFinalizationInput): Promise<AccountingPostResult> {
    const existing = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: input.invoiceId },
      select: { journalEntryId: true },
    });
    if (existing?.journalEntryId) {
      return { journalEntryId: existing.journalEntryId, adopted: true };
    }

    const entry = buildFinalizationEntry({
      gross: input.gross,
      charges: input.charges,
      net: input.net,
    });
    if (!entry.balanced || entry.lines.length === 0) {
      throw new AccountingPostError('Courier settlement entry is unbalanced or empty');
    }

    const journalEntryId = await this.writeEntry(
      entry.lines,
      input.entryDate,
      input.referenceNo,
      input.description,
      input.actor,
      input.invoiceId,
    );

    await this.prisma.courierSettlementInvoice.update({
      where: { id: input.invoiceId },
      data: {
        journalEntryId,
        accountingStatus: 'POSTED',
        accountingError: null,
        accountingAttemptedAt: new Date(),
        accountingAttemptedBy: input.actor ?? null,
      },
    });
    return { journalEntryId, adopted: false };
  }

  /** Post a compensating correction entry; returns the journal id. */
  async postCorrection(input: PostCorrectionInput): Promise<AccountingPostResult> {
    const entry = buildCorrectionEntry({
      deltaG: input.deltaG,
      deltaC: input.deltaC,
      deltaN: input.deltaN,
      counterpart: input.counterpart ?? null,
      residualThreshold: await this.settings.residualThreshold(),
    });
    if (entry.rejected) {
      throw new AccountingPostError(entry.rejectionReason ?? 'Correction rejected');
    }

    const journalEntryId = await this.writeEntry(
      entry.lines,
      input.entryDate,
      input.referenceNo,
      input.description,
      input.actor,
      input.invoiceId,
    );
    return { journalEntryId, adopted: false };
  }

  /** Record a failure without throwing past the caller (state machine honesty). */
  async markFailure(invoiceId: string, message: string, actor?: string | null): Promise<void> {
    await this.prisma.courierSettlementInvoice.update({
      where: { id: invoiceId },
      data: {
        accountingStatus: 'FAILED',
        accountingError: message,
        accountingAttemptedAt: new Date(),
        accountingAttemptedBy: actor ?? null,
      },
    });
  }

  private async writeEntry(
    lines: { account: 'cash' | 'expense' | 'clearing' | 'variance'; debit: number; credit: number }[],
    entryDate: Date,
    referenceNo: string,
    description: string,
    actor: string | null | undefined,
    invoiceId: string,
  ): Promise<string> {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { startDate: { lte: entryDate }, endDate: { gte: entryDate } },
      orderBy: { startDate: 'desc' },
    });
    if (!period || period.isClosed) {
      throw new AccountingPostError(
        `No open financial period for ${entryDate.toISOString().slice(0, 10)}`,
      );
    }

    const accountIds: Record<string, string> = {
      cash: await this.settings.cashAccountId(),
      expense: await this.settings.expenseAccountId(),
      clearing: await this.settings.clearingAccountId(),
      variance: await this.settings.varianceAccountId(),
    };

    const dtoLines = lines.map((l) => ({
      accountId: accountIds[l.account],
      debit: l.debit,
      credit: l.credit,
      description: `${l.account} leg — ${referenceNo}`,
    }));

    try {
      const entry = await this.accounting.createEntry(
        {
          periodId: period.id,
          entryDate: entryDate.toISOString(),
          description,
          referenceNo,
          lines: dtoLines,
        },
        actor ?? undefined,
      );
      return entry.id;
    } catch (e) {
      this.logger.error(
        `Courier settlement journal failed for invoice ${invoiceId}: ${(e as Error).message}`,
      );
      throw new AccountingPostError((e as Error).message);
    }
  }

  /** Dhaka-date attribution for the compensating entry (§14.4). */
  dhakaEntryDate(d: Date = new Date()): Date {
    const { year, month, day } = dhakaDateParts(d);
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }
}