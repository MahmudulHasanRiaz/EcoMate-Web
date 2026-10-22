// ── Phase 2 — auto-journal for RECORDED money movements.
//
// Invariants (non-negotiable, and mirrored in payment-journal.entry.ts):
//
//  1. Every RECORDED (PAID / verified) non-COD payment posts exactly ONE
//     balanced journal entry, through the same `AccountingService.createEntry`
//     the COD courier settlement uses — same service, same entry shape, same
//     append-only behaviour.
//  2. COD receipts post NOTHING here. The courier settlement already posts that
//     leg at finalization (Dr cash / Dr courier expense / Cr COD clearing);
//     posting it again would double count the same cash. See `isCodOrder()` in
//     ./payment-journal.entry.ts — THE guard, called out at each entry point.
//  3. Idempotent. The payment's own identity is the anchor: the unique
//     `journalEntryId` column on Payment/PayrollPayment/SupplierPayment is the
//     exactly-once constraint, an already-posted payment is ADOPTED (never
//     re-posted), and a row lock serializes concurrent posters for one payment.
//  4. Voiding/reversing writes a COMPENSATING entry (`reversalJournalEntryId`)
//     on the original entry's own accounts. Books stay append-only — nothing is
//     ever deleted.
//  5. Posting never breaks the money movement. Every entry point is called
//     AFTER the payment's own transaction has committed, and every one of them
//     returns an outcome instead of throwing.

import { Injectable, Logger } from '@nestjs/common';
import { AccountType, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { FinancialPeriodsService } from '../financial-periods/financial-periods.service';
import { dhakaDateParts } from '../common/utils/dhaka-time';
import {
  COURIER_CLEARING_ACCOUNT_CODE,
  COURIER_CLEARING_ACCOUNT_NAME,
  SETTING_ACCOUNTING_ENABLED,
} from '../courier-settlement/courier-settlement.constants';
import {
  COD_SKIP_REASON,
  ORDER_PAYMENT_REFERENCE_PREFIX,
  PAYROLL_PAYMENT_REFERENCE_PREFIX,
  REFUND_REFERENCE_SUFFIX,
  REVERSAL_REFERENCE_SUFFIX,
  SALARY_EXPENSE_ACCOUNT_CODE,
  SALARY_EXPENSE_ACCOUNT_NAME,
  SUPPLIER_PAYABLE_ACCOUNT_CODE,
  SUPPLIER_PAYABLE_ACCOUNT_NAME,
  SUPPLIER_PAYMENT_REFERENCE_PREFIX,
} from './payment-journal.constants';
import {
  JournalAccountKey,
  JournalLeg,
  LedgerLeg,
  isBalanced,
  isCodOrder,
  mirrorEntry,
  round2,
  twoLegEntry,
} from './payment-journal.entry';

export type PaymentJournalStatus =
  | 'posted'
  | 'adopted'
  | 'reversed'
  | 'skipped'
  | 'failed';

export interface PaymentJournalOutcome {
  status: PaymentJournalStatus;
  journalEntryId: string | null;
  /** Always set for `skipped`/`failed` — never a silent no-op. */
  reason?: string;
}

/** The three payment tables that carry the journal identity anchor. */
type AnchorTable = 'Payment' | 'PayrollPayment' | 'SupplierPayment';

interface DraftLeg extends LedgerLeg {
  accountId: string;
}

interface AnchorDelegate {
  findUnique(args: any): Promise<any>;
  update(args: any): Promise<any>;
}

function skip(reason: string): PaymentJournalOutcome {
  return { status: 'skipped', journalEntryId: null, reason };
}

function adopted(journalEntryId: string): PaymentJournalOutcome {
  return { status: 'adopted', journalEntryId };
}

/** `Payment.recordedBy` may carry the admin's `staff:<userId>` tag. */
function actorIdFrom(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return tag.startsWith('staff:') ? tag.slice('staff:'.length) : tag;
}

/** Dhaka-calendar-day attribution for the entry date (mirrors the settlement's
 * `dhakaEntryDate`). The UTC-midnight-of-the-Dhaka-day instant always falls
 * inside a UTC-boundary monthly period. */
function dhakaEntryDate(d: Date): Date {
  const { year, month, day } = dhakaDateParts(d);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

@Injectable()
export class PaymentJournalService {
  private readonly logger = new Logger(PaymentJournalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly periods: FinancialPeriodsService,
  ) {}

  /** Same gate the settlement uses: `SystemSetting.accounting_enabled`. */
  async isEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: SETTING_ACCOUNTING_ENABLED },
      });
      return row?.value === 'true';
    } catch {
      return false;
    }
  }

  // ── order payments (also the money-out mirror for refunds) ────────────────

  /**
   * Receipt for a recorded order payment: Dr the gateway's mapped asset leaf /
   * Cr the same clearing account the COD settlement credits. A negative amount
   * (a reversal/refund row) posts the mirror automatically.
   */
  async tryPostOrderPayment(paymentId: string): Promise<PaymentJournalOutcome> {
    return this.guard(`order payment ${paymentId}`, async () => {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          order: { select: { displayId: true, paymentOptionType: true } },
        },
      });
      if (!payment) return skip('payment_not_found');
      if (payment.journalEntryId) return adopted(payment.journalEntryId);
      if (payment.status !== PaymentStatus.PAID)
        return skip('payment_not_recorded');
      // ── COD GUARD (directive crux). The courier settlement posts this cash;
      // posting it here too would count it twice. ──
      if (isCodOrder(payment.order)) return skip(COD_SKIP_REASON);
      if (!payment.accountId) return skip('no_mapped_account');
      if (!(await this.isEnabled())) return skip('accounting_disabled');

      const legs = twoLegEntry('asset', 'contra', Number(payment.amount));
      if (legs.length === 0) return skip('zero_amount');

      return this.withAnchorLock('Payment', paymentId, async (tx) => {
        const fresh = await this.anchorDelegate(tx, 'Payment').findUnique({
          where: { id: paymentId },
          select: { journalEntryId: true },
        });
        if (!fresh) return skip('payment_not_found');
        if (fresh.journalEntryId) return adopted(fresh.journalEntryId);

        const draft = await this.resolveLegs(legs, payment.accountId);
        if (!draft) return skip('no_mapped_account');

        const journalEntryId = await this.write({
          legs: draft,
          entryDate: dhakaEntryDate(payment.recordedAt ?? payment.createdAt),
          referenceNo: `${ORDER_PAYMENT_REFERENCE_PREFIX}-${payment.id}`,
          description:
            `Order payment received` +
            `${payment.order?.displayId ? ` — ${payment.order.displayId}` : ''}` +
            ` (${payment.gatewayCode})`,
          actor: actorIdFrom(payment.recordedBy),
        });
        await this.anchorDelegate(tx, 'Payment').update({
          where: { id: paymentId },
          data: { journalEntryId },
        });
        return { status: 'posted' as const, journalEntryId };
      });
    });
  }

  /**
   * Refund mirror. The refund is booked by refunds.service.ts as a NEGATIVE
   * Payment row, so the signed receipt builder produces the reverse of the
   * original receipt on the original's contra account by construction.
   *
   * Account choice: Phase 1 gave refunds their own gateway + account select, so
   * that explicit selection wins; when it is absent the ORIGINAL payment's
   * `accountId` is the fallback of truth. In the normal case (refund through
   * the same gateway as the receipt) both are the same account, so the entry
   * sits on exactly the accounts the original used.
   */
  async tryPostRefundMirror(
    refundPaymentId: string,
    sourcePaymentId?: string | null,
  ): Promise<PaymentJournalOutcome> {
    return this.guard(`refund mirror ${refundPaymentId}`, async () => {
      const payment = await this.prisma.payment.findUnique({
        where: { id: refundPaymentId },
        include: {
          order: { select: { displayId: true, paymentOptionType: true } },
        },
      });
      if (!payment) return skip('payment_not_found');
      if (payment.journalEntryId) return adopted(payment.journalEntryId);
      if (payment.status !== PaymentStatus.PAID)
        return skip('payment_not_recorded');
      if (isCodOrder(payment.order)) return skip(COD_SKIP_REASON);

      const source = sourcePaymentId
        ? await this.prisma.payment.findUnique({
            where: { id: sourcePaymentId },
            select: { id: true, accountId: true },
          })
        : null;
      const assetAccountId = payment.accountId ?? source?.accountId ?? null;
      if (!assetAccountId) return skip('no_mapped_account');
      if (!(await this.isEnabled())) return skip('accounting_disabled');

      const legs = twoLegEntry('asset', 'contra', Number(payment.amount));
      if (legs.length === 0) return skip('zero_amount');

      return this.withAnchorLock('Payment', refundPaymentId, async (tx) => {
        const fresh = await this.anchorDelegate(tx, 'Payment').findUnique({
          where: { id: refundPaymentId },
          select: { journalEntryId: true },
        });
        if (!fresh) return skip('payment_not_found');
        if (fresh.journalEntryId) return adopted(fresh.journalEntryId);

        const draft = await this.resolveLegs(legs, assetAccountId);
        if (!draft) return skip('no_mapped_account');

        const journalEntryId = await this.write({
          legs: draft,
          entryDate: dhakaEntryDate(payment.recordedAt ?? payment.createdAt),
          referenceNo:
            `${ORDER_PAYMENT_REFERENCE_PREFIX}-${payment.id}` +
            `-${REFUND_REFERENCE_SUFFIX}`,
          description:
            `Refund paid${payment.order?.displayId ? ` — ${payment.order.displayId}` : ''}` +
            `${source ? ` (mirror of payment ${source.id})` : ''}`,
          actor: actorIdFrom(payment.recordedBy),
        });
        await this.anchorDelegate(tx, 'Payment').update({
          where: { id: refundPaymentId },
          data: { journalEntryId },
        });
        return { status: 'posted' as const, journalEntryId };
      });
    });
  }

  // ── payroll payments ─────────────────────────────────────────────────────

  /** Dr the salary/compensation expense leaf / Cr the mapped asset leaf. */
  async tryPostPayrollPayment(
    paymentId: string,
  ): Promise<PaymentJournalOutcome> {
    return this.guard(`payroll payment ${paymentId}`, async () => {
      const payment = await this.prisma.payrollPayment.findUnique({
        where: { id: paymentId },
        include: { payslip: { select: { periodKey: true } } },
      });
      if (!payment) return skip('payment_not_found');
      if (payment.journalEntryId) return adopted(payment.journalEntryId);
      if (payment.voidedAt) return skip('payment_voided');
      if (!payment.accountId) return skip('no_mapped_account');
      if (!(await this.isEnabled())) return skip('accounting_disabled');

      const legs = twoLegEntry('expense', 'asset', Number(payment.amount));
      if (legs.length === 0) return skip('zero_amount');

      return this.withAnchorLock('PayrollPayment', paymentId, async (tx) => {
        const fresh = await this.anchorDelegate(tx, 'PayrollPayment').findUnique({
          where: { id: paymentId },
          select: { journalEntryId: true },
        });
        if (!fresh) return skip('payment_not_found');
        if (fresh.journalEntryId) return adopted(fresh.journalEntryId);

        const draft = await this.resolveLegs(legs, payment.accountId);
        if (!draft) return skip('no_mapped_account');

        const journalEntryId = await this.write({
          legs: draft,
          entryDate: dhakaEntryDate(payment.paidAt),
          referenceNo: `${PAYROLL_PAYMENT_REFERENCE_PREFIX}-${payment.id}`,
          description:
            `Salary payment — payslip ` +
            `${payment.payslip?.periodKey ?? payment.payslipId}` +
            `${payment.method ? ` via ${payment.method}` : ''}`,
          actor: payment.recordedById ?? null,
        });
        await this.anchorDelegate(tx, 'PayrollPayment').update({
          where: { id: paymentId },
          data: { journalEntryId },
        });
        return { status: 'posted' as const, journalEntryId };
      });
    });
  }

  /** Reverse a payroll payment's journal (called on void). */
  async tryReversePayrollPayment(
    paymentId: string,
    reason: string,
  ): Promise<PaymentJournalOutcome> {
    return this.reverseAnchored(
      'PayrollPayment',
      paymentId,
      PAYROLL_PAYMENT_REFERENCE_PREFIX,
      reason,
    );
  }

  // ── supplier payments ────────────────────────────────────────────────────

  /** Dr the supplier payable leaf / Cr the mapped asset leaf. */
  async tryPostSupplierPayment(
    paymentId: string,
  ): Promise<PaymentJournalOutcome> {
    return this.guard(`supplier payment ${paymentId}`, async () => {
      const payment = await this.prisma.supplierPayment.findUnique({
        where: { id: paymentId },
        include: { supplier: { select: { name: true } } },
      });
      if (!payment) return skip('payment_not_found');
      if (payment.journalEntryId) return adopted(payment.journalEntryId);
      if (!payment.accountId) return skip('no_mapped_account');
      if (!(await this.isEnabled())) return skip('accounting_disabled');

      const legs = twoLegEntry('payable', 'asset', Number(payment.amount));
      if (legs.length === 0) return skip('zero_amount');

      return this.withAnchorLock('SupplierPayment', paymentId, async (tx) => {
        const fresh = await this.anchorDelegate(
          tx,
          'SupplierPayment',
        ).findUnique({
          where: { id: paymentId },
          select: { journalEntryId: true },
        });
        if (!fresh) return skip('payment_not_found');
        if (fresh.journalEntryId) return adopted(fresh.journalEntryId);

        const draft = await this.resolveLegs(legs, payment.accountId);
        if (!draft) return skip('no_mapped_account');

        const journalEntryId = await this.write({
          legs: draft,
          entryDate: dhakaEntryDate(payment.paidAt),
          referenceNo: `${SUPPLIER_PAYMENT_REFERENCE_PREFIX}-${payment.id}`,
          description:
            `Supplier payment — ${payment.supplier?.name ?? payment.supplierId}` +
            `${payment.paymentMethod ? ` via ${payment.paymentMethod}` : ''}`,
          actor: null,
        });
        await this.anchorDelegate(tx, 'SupplierPayment').update({
          where: { id: paymentId },
          data: { journalEntryId },
        });
        return { status: 'posted' as const, journalEntryId };
      });
    });
  }

  /** Reverse a supplier payment's journal. */
  async tryReverseSupplierPayment(
    paymentId: string,
    reason: string,
  ): Promise<PaymentJournalOutcome> {
    return this.reverseAnchored(
      'SupplierPayment',
      paymentId,
      SUPPLIER_PAYMENT_REFERENCE_PREFIX,
      reason,
    );
  }

  // ── order payment reversal (a posted payment that stops being PAID) ───────

  /** Reverse an order payment's journal on the SAME accounts it used. */
  async tryReverseOrderPayment(
    paymentId: string,
    reason: string,
  ): Promise<PaymentJournalOutcome> {
    return this.reverseAnchored(
      'Payment',
      paymentId,
      ORDER_PAYMENT_REFERENCE_PREFIX,
      reason,
    );
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Never throws: a journal failure must not break a money movement. */
  private async guard(
    label: string,
    fn: () => Promise<PaymentJournalOutcome>,
  ): Promise<PaymentJournalOutcome> {
    try {
      return await fn();
    } catch (e) {
      const reason = (e as Error).message;
      this.logger.error(`Auto-journal failed for ${label}: ${reason}`);
      return { status: 'failed', journalEntryId: null, reason };
    }
  }

  /**
   * Serialize concurrent posters for ONE payment row (double-clicked verify,
   * racing retries) so the unique anchor can never be beaten into two entries.
   * Mirrors the `SELECT … FOR UPDATE` idiom used by payments.service.ts.
   */
  private async withAnchorLock(
    table: AnchorTable,
    id: string,
    run: (tx: Prisma.TransactionClient) => Promise<PaymentJournalOutcome>,
  ): Promise<PaymentJournalOutcome> {
    return this.prisma.$transaction(async (tx) => {
      // `table` is a closed union literal — never user input.
      await tx.$queryRawUnsafe(
        `SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`,
        id,
      );
      return run(tx);
    });
  }

  private anchorDelegate(
    client: PrismaService | Prisma.TransactionClient,
    table: AnchorTable,
  ): AnchorDelegate {
    const key = table.charAt(0).toLowerCase() + table.slice(1);
    return (client as any)[key] as AnchorDelegate;
  }

  /** Compensating entry for an already-posted payment. */
  private async reverseAnchored(
    table: AnchorTable,
    id: string,
    referencePrefix: string,
    reason: string,
  ): Promise<PaymentJournalOutcome> {
    return this.guard(`reversal of ${table} ${id}`, async () => {
      const row = await this.anchorDelegate(this.prisma, table).findUnique({
        where: { id },
        select: { journalEntryId: true, reversalJournalEntryId: true },
      });
      if (!row) return skip('payment_not_found');
      if (row.reversalJournalEntryId)
        return adopted(row.reversalJournalEntryId);
      if (!row.journalEntryId) return skip('nothing_to_reverse');
      if (!(await this.isEnabled())) return skip('accounting_disabled');

      return this.withAnchorLock(table, id, async (tx) => {
        const fresh = await this.anchorDelegate(tx, table).findUnique({
          where: { id },
          select: { journalEntryId: true, reversalJournalEntryId: true },
        });
        if (!fresh) return skip('payment_not_found');
        if (fresh.reversalJournalEntryId)
          return adopted(fresh.reversalJournalEntryId);
        if (!fresh.journalEntryId) return skip('nothing_to_reverse');

        const source = await this.prisma.journalEntry.findUnique({
          where: { id: fresh.journalEntryId },
          include: { lines: true },
        });
        if (!source) return skip('journal_entry_not_found');

        const legs = mirrorEntry(
          source.lines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit),
            credit: Number(l.credit),
          })),
        );
        const journalEntryId = await this.write({
          legs,
          entryDate: dhakaEntryDate(new Date()),
          referenceNo: `${referencePrefix}-${id}-${REVERSAL_REFERENCE_SUFFIX}`,
          description:
            `Reversal of ${source.entryNo}` +
            `${source.referenceNo ? ` (${source.referenceNo})` : ''} — ${reason}`,
          actor: null,
        });
        await this.anchorDelegate(tx, table).update({
          where: { id },
          data: { reversalJournalEntryId: journalEntryId },
        });
        return { status: 'reversed' as const, journalEntryId };
      });
    });
  }

  /** Map the logical legs onto real chart-of-accounts ids, creating the
   * Phase 2 system leaves lazily (this codebase seeds no chart of accounts). */
  private async resolveLegs(
    legs: JournalLeg[],
    assetAccountId: string | null,
  ): Promise<DraftLeg[] | null> {
    const required = new Set(legs.map((l) => l.account));
    const ids: Partial<Record<JournalAccountKey, string>> = {};

    if (required.has('asset')) {
      if (!assetAccountId) return null;
      ids.asset = assetAccountId;
    }
    if (required.has('contra')) {
      ids.contra = await this.ensureAccount(
        COURIER_CLEARING_ACCOUNT_CODE,
        COURIER_CLEARING_ACCOUNT_NAME,
        AccountType.liability,
      );
    }
    if (required.has('expense')) {
      ids.expense = await this.ensureAccount(
        SALARY_EXPENSE_ACCOUNT_CODE,
        SALARY_EXPENSE_ACCOUNT_NAME,
        AccountType.expense,
      );
    }
    if (required.has('payable')) {
      ids.payable = await this.ensureAccount(
        SUPPLIER_PAYABLE_ACCOUNT_CODE,
        SUPPLIER_PAYABLE_ACCOUNT_NAME,
        AccountType.liability,
      );
    }

    return legs.map((l) => ({
      accountId: ids[l.account] as string,
      debit: l.debit,
      credit: l.credit,
    }));
  }

  private async ensureAccount(
    code: string,
    name: string,
    type: AccountType,
  ): Promise<string> {
    const existing = await this.prisma.account.findUnique({ where: { code } });
    if (existing) return existing.id;
    try {
      const created = await this.prisma.account.create({
        data: { code, name, type, isGroup: false },
      });
      this.logger.log(`Created system account ${created.code} (${created.id})`);
      return created.id;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const raced = await this.prisma.account.findUnique({
          where: { code },
        });
        if (raced) return raced.id;
      }
      throw e;
    }
  }

  /** The single writer. Mirrors the settlement's `writeEntry`: resolve the
   * covering OPEN period, then post through `AccountingService.createEntry`. */
  private async write(input: {
    legs: DraftLeg[];
    entryDate: Date;
    referenceNo: string;
    description: string;
    actor?: string | null;
  }): Promise<string> {
    if (!isBalanced(input.legs)) {
      throw new Error('payment journal entry is unbalanced or empty');
    }
    const period = await this.periods.ensurePeriodCovering(input.entryDate);
    if (!period) {
      throw new Error(
        `no financial period covers ${input.entryDate.toISOString().slice(0, 10)}`,
      );
    }
    if (period.isClosed) {
      throw new Error(`financial period "${period.name}" is closed`);
    }

    const entry = await this.accounting.createEntry(
      {
        periodId: period.id,
        entryDate: input.entryDate.toISOString(),
        description: input.description,
        referenceNo: input.referenceNo,
        lines: input.legs.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          description: `${input.referenceNo} leg`,
        })),
      },
      input.actor ?? undefined,
    );
    return entry.id;
  }
}

/** Re-exported so callers can round the amount they hand in, if they need to. */
export { round2 };
