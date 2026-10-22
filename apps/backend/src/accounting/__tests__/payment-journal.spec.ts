/**
 * Phase 2 — auto-journal for recorded money movements (directive mandatory
 * tests a/b/c).
 *
 * This spec drives the REAL `PaymentJournalService`, the REAL
 * `AccountingService` (so balance validation and entry persistence are the
 * production code, not a stub) and the REAL `FinancialPeriodsService` over an
 * in-memory Prisma fake. That is what lets it assert the actual Dr/Cr lines
 * rather than a call shape.
 *
 * Traced posting pattern it mirrors (Part 1 of the directive):
 *   `CourierSettlementAccountingService.postFinalization`
 *   (courier-settlement-accounting.service.ts:68) → private `writeEntry()` (:145)
 *   → `AccountingService.createEntry` (accounting.service.ts:13).
 */

import { ConflictException } from '@nestjs/common';
import { AccountingService } from '../accounting.service';
import { PaymentJournalService } from '../payment-journal.service';
import { isCodOrder } from '../payment-journal.entry';
import {
  SALARY_EXPENSE_ACCOUNT_CODE,
  SUPPLIER_PAYABLE_ACCOUNT_CODE,
  COD_SKIP_REASON,
} from '../payment-journal.constants';
import { FinancialPeriodsService } from '../../financial-periods/financial-periods.service';
import { CourierSettlementAccountingService } from '../../courier-settlement/courier-settlement-accounting.service';
import { CourierSettlementSettingsService } from '../../courier-settlement/courier-settlement-settings.service';

// ── in-memory Prisma fake ───────────────────────────────────────────────────

class FakeDb {
  accounts: any[] = [];
  periods: any[] = [];
  entries: any[] = [];
  lines: any[] = [];
  counters: any[] = [];
  settings: any[] = [];
  payments: any[] = [];
  payrollPayments: any[] = [];
  supplierPayments: any[] = [];
  orders: any[] = [];
  payslips: any[] = [];
  suppliers: any[] = [];
  invoices: any[] = [];

  $queryRawUnsafe = async (sql: string, ...args: unknown[]) => {
    // The report methods in AccountingService are raw SQL over exactly these
    // in-memory tables; emulate that SQL so Part 3's "visible in the P&L"
    // assertion walks the REAL report code path rather than a stub.
    const periodId = args[0] as string | undefined;
    if (sql.includes('total_debit')) {
      return this.reportRows(periodId, null).map((r) => ({
        ...r,
        total_debit: r.balance > 0 ? r.balance : 0,
        total_credit: r.balance < 0 ? -r.balance : 0,
      }));
    }
    if (sql.includes("'income'") && sql.includes('expense')) {
      return this.reportRows(periodId, ['income', 'expense']);
    }
    if (sql.includes('asset') && sql.includes('liability')) {
      return this.reportRows(periodId, ['asset', 'liability', 'equity']);
    }
    return [];
  };
  $transaction = async (fn: any) => fn(this);

  /** SUM(debit − credit) per active account, scoped to one period. */
  private reportRows(periodId: string | undefined, types: string[] | null) {
    return this.accounts
      .filter((a) => a.isActive !== false)
      .filter((a) => !types || types.includes(a.type))
      .map((a) => {
        const balance = this.lines
          .filter((l) => l.accountId === a.id)
          .filter((l) => {
            const entry = this.entries.find((e) => e.id === l.entryId);
            if (!entry) return false;
            return !periodId || entry.periodId === periodId;
          })
          .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
        return {
          type: a.type,
          account_id: a.id,
          account_code: a.code,
          account_name: a.name,
          balance,
        };
      });
  }

  private matchAccount(where: any) {
    if (!where) return () => true;
    if (where.code !== undefined) return (a: any) => a.code === where.code;
    if (where.id !== undefined) return (a: any) => a.id === where.id;
    return () => true;
  }

  get systemSetting() {
    return {
      findUnique: async ({ where }: any) =>
        this.settings.find((s) => s.key === where.key) ?? null,
    };
  }

  get account() {
    return {
      findUnique: async ({ where }: any) =>
        this.accounts.find(this.matchAccount(where)) ?? null,
      findFirst: async ({ where }: any) =>
        this.accounts.find(this.matchAccount(where)) ?? null,
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return this.accounts.filter((a) => ids.includes(a.id));
      },
      create: async ({ data }: any) => {
        if (this.accounts.some((a) => a.code === data.code)) {
          const err: any = new Error('Unique constraint failed on code');
          err.code = 'P2002';
          throw err;
        }
        const row = {
          id: `acc-${this.accounts.length + 1}`,
          isGroup: false,
          isActive: true,
          ...data,
        };
        this.accounts.push(row);
        return row;
      },
    };
  }

  get financialPeriod() {
    return {
      findUnique: async ({ where }: any) =>
        this.periods.find((p) => p.id === where.id) ?? null,
      findFirst: async ({ where }: any) =>
        this.periods.find((p) => {
          const afterStart = where?.startDate?.lte
            ? p.startDate <= where.startDate.lte
            : true;
          const beforeEnd = where?.endDate?.gte
            ? p.endDate >= where.endDate.gte
            : true;
          return afterStart && beforeEnd;
        }) ?? null,
      create: async ({ data }: any) => {
        const overlapping = this.periods.find(
          (p) => p.startDate <= data.endDate && p.endDate >= data.startDate,
        );
        if (overlapping) {
          throw new ConflictException(
            'A financial period already exists for this date range',
          );
        }
        const row = { id: `per-${this.periods.length + 1}`, isClosed: false, ...data };
        this.periods.push(row);
        return row;
      },
      count: async ({ where }: any) =>
        this.entries.filter((e) =>
          where?.periodId ? e.periodId === where.periodId : true,
        ).length,
    };
  }

  get orderCounter() {
    return {
      upsert: async ({ where, update, create }: any) => {
        let row = this.counters.find((c) => c.date === where.date);
        if (row) row.seq += update.seq.increment;
        else {
          row = { date: where.date, seq: create.seq };
          this.counters.push(row);
        }
        return { ...row };
      },
    };
  }

  get journalEntry() {
    return {
      create: async ({ data }: any) => {
        const { lines, ...rest } = data;
        const row = { id: `je-${this.entries.length + 1}`, ...rest };
        this.entries.push(row);
        for (const line of lines?.create ?? []) {
          this.lines.push({
            id: `jel-${this.lines.length + 1}`,
            entryId: row.id,
            ...line,
          });
        }
        return this.hydrateEntry(row);
      },
      findUnique: async ({ where }: any) => {
        const row = this.entries.find((e) => e.id === where.id);
        return row ? this.hydrateEntry(row) : null;
      },
      count: async ({ where }: any) =>
        this.entries.filter((e) =>
          where?.periodId ? e.periodId === where.periodId : true,
        ).length,
    };
  }

  get payment() {
    return {
      findUnique: async ({ where }: any) => {
        const row = this.payments.find((p) => p.id === where.id);
        return row ? this.hydratePayment(row) : null;
      },
      findMany: async ({ where, take }: any) =>
        this.payments
          .filter((p) => this.matches(p, where))
          .slice(0, take ?? undefined)
          .map((p) => ({ ...p, order: this.orderOf(p) })),
      create: async ({ data }: any) => {
        const row = { id: `pay-${this.payments.length + 1}`, ...data };
        this.payments.push(row);
        return this.hydratePayment(row);
      },
      update: async ({ where, data }: any) => {
        const row = this.payments.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return this.hydratePayment(row);
      },
    };
  }

  /** Minimal Prisma `where` interpreter for the shapes this suite uses:
   * equality, `null`, and the `not` / `gt` / `in` operators. */
  private matches(row: any, where: any): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond === null) return value === null || value === undefined;
      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
        const op = cond as Record<string, unknown>;
        if ('not' in op) return value !== op.not && value !== null && value !== undefined;
        if ('gt' in op) return Number(value) > Number(op.gt);
        if ('in' in op) return (op.in as unknown[]).includes(value);
        return true;
      }
      return value === cond;
    });
  }

  get payrollPayment() {
    return {
      findUnique: async ({ where }: any) => {
        const row = this.payrollPayments.find((p) => p.id === where.id);
        if (!row) return null;
        return {
          ...row,
          payslip: this.payslips.find((s) => s.id === row.payslipId) ?? null,
        };
      },
      findMany: async ({ where, take }: any) =>
        this.payrollPayments
          .filter((p) => this.matches(p, where))
          .slice(0, take ?? undefined),
      update: async ({ where, data }: any) => {
        const row = this.payrollPayments.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    };
  }

  get supplierPayment() {
    return {
      findUnique: async ({ where }: any) => {
        const row = this.supplierPayments.find((p) => p.id === where.id);
        if (!row) return null;
        return {
          ...row,
          supplier: this.suppliers.find((s) => s.id === row.supplierId) ?? null,
        };
      },
      findMany: async ({ where, take }: any) =>
        this.supplierPayments
          .filter((p) => this.matches(p, where))
          .slice(0, take ?? undefined),
      update: async ({ where, data }: any) => {
        const row = this.supplierPayments.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    };
  }

  get courierSettlementInvoice() {
    return {
      findUnique: async ({ where }: any) =>
        this.invoices.find((i) => i.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = this.invoices.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    };
  }

  private orderOf(payment: any) {
    return this.orders.find((o) => o.id === payment.orderId) ?? null;
  }

  private hydratePayment(row: any) {
    return { ...row, order: this.orderOf(row) };
  }

  private hydrateEntry(row: any) {
    return {
      ...row,
      lines: this.lines
        .filter((l) => l.entryId === row.id)
        .map((l) => ({ ...l, account: this.accounts.find((a) => a.id === l.accountId) })),
      period: this.periods.find((p) => p.id === row.periodId) ?? null,
    };
  }
}

// ── harness helpers ─────────────────────────────────────────────────────────

function makeHarness(opts: { accountingEnabled?: boolean } = {}) {
  const db = new FakeDb();
  if (opts.accountingEnabled !== false) {
    db.settings.push({ key: 'accounting_enabled', value: 'true' });
  }
  // The Phase 1 bridge: an eligible asset leaf (Cash/Bank) per gateway.
  db.accounts.push({
    id: 'acc-bank',
    code: 'bank-main',
    name: 'Main Bank',
    type: 'asset',
    isGroup: false,
    isActive: true,
  });

  const accounting = new AccountingService(db as any);
  const periods = new FinancialPeriodsService(db as any);
  const journal = new PaymentJournalService(db as any, accounting, periods);
  const settlementSettings = new CourierSettlementSettingsService(db as any);
  const settlement = new CourierSettlementAccountingService(
    db as any,
    accounting,
    settlementSettings,
  );

  return { db, accounting, periods, journal, settlement };
}

const lineSpec = (db: FakeDb, entryId: string) =>
  db.lines
    .filter((l) => l.entryId === entryId)
    .map((l) => ({
      code: db.accounts.find((a) => a.id === l.accountId)?.code,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }));

/** Signed net (debit − credit) of every line on an account, across all entries. */
const netOn = (db: FakeDb, accountId: string) =>
  db.lines
    .filter((l) => l.accountId === accountId)
    .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

const totals = (db: FakeDb) => ({
  debit: db.entries.reduce((s, e) => s + Number(e.totalDebit), 0),
  credit: db.entries.reduce((s, e) => s + Number(e.totalCredit), 0),
});

const accountIdOf = (db: FakeDb, code: string) =>
  db.accounts.find((a) => a.code === code)?.id as string;

// ── tests ───────────────────────────────────────────────────────────────────

describe('PaymentJournalService — Phase 2 auto-journal', () => {
  describe('(a) payroll payment: exactly one balanced entry, then a reversal', () => {
    const payrollPayment = (over: Record<string, unknown> = {}) => ({
      id: 'pp-1',
      payslipId: 'ps-1',
      amount: 10000,
      method: 'cash',
      accountId: 'acc-bank',
      recordedById: 'user-1',
      paidAt: new Date('2026-10-15T06:00:00.000Z'),
      voidedAt: null,
      journalEntryId: null,
      reversalJournalEntryId: null,
      ...over,
    });

    it('posts Dr salary expense / Cr mapped asset, balanced, exactly once', async () => {
      const { db, journal } = makeHarness();
      db.payrollPayments.push(payrollPayment());
      db.payslips.push({ id: 'ps-1', periodKey: '2026-10' });

      const outcome = await journal.tryPostPayrollPayment('pp-1');

      expect(outcome).toEqual({ status: 'posted', journalEntryId: 'je-1' });
      expect(db.entries).toHaveLength(1);

      const entry = db.entries[0];
      expect(Number(entry.totalDebit)).toBe(10000);
      expect(Number(entry.totalCredit)).toBe(10000);
      expect(Number(entry.totalDebit)).toBe(Number(entry.totalCredit));

      // The salary/compensation expense leaf did not exist before Phase 2 — it
      // is created lazily through the same seam the COD settlement uses.
      expect(accountIdOf(db, SALARY_EXPENSE_ACCOUNT_CODE)).toBeTruthy();
      expect(
        db.accounts.find((a) => a.code === SALARY_EXPENSE_ACCOUNT_CODE),
      ).toMatchObject({ type: 'expense', isGroup: false });

      expect(lineSpec(db, 'je-1')).toEqual([
        { code: SALARY_EXPENSE_ACCOUNT_CODE, debit: 10000, credit: 0 },
        { code: 'bank-main', debit: 0, credit: 10000 },
      ]);

      // The payment is anchored to its entry (the exactly-once constraint).
      expect(db.payrollPayments[0].journalEntryId).toBe('je-1');
    });

    it('re-processing the same payment adopts the existing entry (no duplicate)', async () => {
      const { db, journal } = makeHarness();
      db.payrollPayments.push(payrollPayment());

      await journal.tryPostPayrollPayment('pp-1');
      const again = await journal.tryPostPayrollPayment('pp-1');

      expect(again).toEqual({ status: 'adopted', journalEntryId: 'je-1' });
      expect(db.entries).toHaveLength(1);
    });

    it('voiding posts ONE reversing entry that nets the books to zero', async () => {
      const { db, journal } = makeHarness();
      db.payrollPayments.push(payrollPayment());

      await journal.tryPostPayrollPayment('pp-1');
      db.payrollPayments[0].voidedAt = new Date('2026-10-16T06:00:00.000Z');
      const reversed = await journal.tryReversePayrollPayment(
        'pp-1',
        'payroll payment voided: wrong payslip',
      );

      expect(reversed.status).toBe('reversed');
      expect(db.entries).toHaveLength(2);

      // Append-only: the original entry is still there, untouched.
      expect(lineSpec(db, 'je-1')).toEqual([
        { code: SALARY_EXPENSE_ACCOUNT_CODE, debit: 10000, credit: 0 },
        { code: 'bank-main', debit: 0, credit: 10000 },
      ]);
      // The compensating entry is the mirror, on the ORIGINAL's own accounts.
      expect(lineSpec(db, 'je-2')).toEqual([
        { code: SALARY_EXPENSE_ACCOUNT_CODE, debit: 0, credit: 10000 },
        { code: 'bank-main', debit: 10000, credit: 0 },
      ]);

      // Net effect across both entries is zero on every account involved.
      expect(netOn(db, accountIdOf(db, SALARY_EXPENSE_ACCOUNT_CODE))).toBe(0);
      expect(netOn(db, 'acc-bank')).toBe(0);
      expect(totals(db)).toEqual({ debit: 20000, credit: 20000 });

      expect(db.payrollPayments[0].reversalJournalEntryId).toBe('je-2');
      // Nothing was deleted.
      expect(db.entries).toHaveLength(2);
    });

    it('reversing twice adopts the first reversal and writes nothing further', async () => {
      const { db, journal } = makeHarness();
      db.payrollPayments.push(payrollPayment());

      await journal.tryPostPayrollPayment('pp-1');
      await journal.tryReversePayrollPayment('pp-1', 'void');
      const again = await journal.tryReversePayrollPayment('pp-1', 'void');

      expect(again).toEqual({ status: 'adopted', journalEntryId: 'je-2' });
      expect(db.entries).toHaveLength(2);
    });

    it('posts nothing when the payment has no mapped account or is voided', async () => {
      const noAccount = makeHarness();
      noAccount.db.payrollPayments.push(
        payrollPayment({ accountId: null }),
      );
      expect(await noAccount.journal.tryPostPayrollPayment('pp-1')).toEqual({
        status: 'skipped',
        journalEntryId: null,
        reason: 'no_mapped_account',
      });

      const voided = makeHarness();
      voided.db.payrollPayments.push(
        payrollPayment({ voidedAt: new Date() }),
      );
      expect(await voided.journal.tryPostPayrollPayment('pp-1')).toEqual({
        status: 'skipped',
        journalEntryId: null,
        reason: 'payment_voided',
      });
      expect(voided.db.entries).toHaveLength(0);
    });

    it('creates the covering monthly period when none exists, and reuses it after', async () => {
      const { db, journal } = makeHarness();
      db.payrollPayments.push(payrollPayment());

      await journal.tryPostPayrollPayment('pp-1');
      expect(db.periods).toHaveLength(1);
      expect(db.periods[0].name).toBe('October 2026');
      expect(db.periods[0].startDate.toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      );
      expect(db.periods[0].endDate.toISOString()).toBe(
        '2026-10-31T23:59:59.999Z',
      );

      db.payrollPayments.push(
        payrollPayment({ id: 'pp-2', payslipId: 'ps-1' }),
      );
      await journal.tryPostPayrollPayment('pp-2');
      expect(db.periods).toHaveLength(1); // reused, not duplicated
      expect(db.entries).toHaveLength(2);
    });

    it('refuses to post into a CLOSED period (logged as failed, never thrown)', async () => {
      const { db, journal } = makeHarness();
      db.payrollPayments.push(payrollPayment());
      db.periods.push({
        id: 'per-closed',
        name: 'October 2026',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-31T23:59:59.999Z'),
        isClosed: true,
      });

      const outcome = await journal.tryPostPayrollPayment('pp-1');
      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toContain('closed');
      expect(db.entries).toHaveLength(0);
    });
  });

  describe('(b) THE COD GUARD — a COD receipt posts nothing; the settlement posts once', () => {
    const codOrder = {
      id: 'ord-cod',
      displayId: 'ORD-260101-0001',
      paymentOptionType: 'CASH_ON_DELIVERY',
    };

    it('classifies COD from the ORDER, not the gateway code', () => {
      // Mirrors courier-settlement/economics.ts:89.
      expect(isCodOrder(codOrder)).toBe(true);
      // Storefront COD orders stamp gatewayCode 'cash' — the SAME code POS
      // counter sales use — so the gateway code can never be the signal.
      expect(isCodOrder({ paymentOptionType: 'FULL_PAYMENT' })).toBe(false);
      expect(isCodOrder({ paymentOptionType: null })).toBe(false);
      expect(isCodOrder({})).toBe(false);
      expect(isCodOrder(null)).toBe(false);
    });

    it('posts ZERO journals for the COD payment row, and exactly ONE for the settlement', async () => {
      const { db, journal, settlement } = makeHarness();
      db.orders.push(codOrder);
      db.payments.push({
        id: 'pay-cod',
        orderId: 'ord-cod',
        gatewayCode: 'cash',
        amount: 850,
        accountId: 'acc-bank',
        status: 'PAID',
        recordedBy: 'staff:user-1',
        recordedAt: new Date('2026-10-20T06:00:00.000Z'),
        createdAt: new Date('2026-10-20T06:00:00.000Z'),
        journalEntryId: null,
        reversalJournalEntryId: null,
      });

      // 1. Recording the COD payment posts NOTHING.
      const outcome = await journal.tryPostOrderPayment('pay-cod');
      expect(outcome).toEqual({
        status: 'skipped',
        journalEntryId: null,
        reason: COD_SKIP_REASON,
      });
      expect(db.entries).toHaveLength(0);
      expect(db.payments[0].journalEntryId).toBeNull();

      // 2. The settlement still posts its one leg — unchanged existing path.
      // The covering period exists in a real deployment because the accounting
      // module bootstraps the current year's months (Part 4); the settlement
      // itself resolves a period rather than creating one.
      db.periods.push({
        id: 'per-oct',
        name: 'October 2026',
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: new Date('2026-10-31T23:59:59.999Z'),
        isClosed: false,
      });
      db.invoices.push({ id: 'inv-1', journalEntryId: null });
      const posted = await settlement.postFinalization({
        invoiceId: 'inv-1',
        gross: 850,
        charges: 50,
        net: 800,
        entryDate: new Date('2026-10-20T00:00:00.000Z'),
        referenceNo: 'CS-260101-0001',
        description: 'COD settlement CS-260101-0001',
      });

      expect(posted.adopted).toBe(false);
      expect(db.entries).toHaveLength(1); // NOT two — no double count
      expect(lineSpec(db, posted.journalEntryId)).toEqual([
        { code: 'courier-cash', debit: 800, credit: 0 },
        { code: 'courier-expense', debit: 50, credit: 0 },
        { code: 'courier-cod-clearing', debit: 0, credit: 850 },
      ]);
    });
  });

  describe('(c) retry idempotency for a non-COD order payment', () => {
    const orderPayment = (over: Record<string, unknown> = {}) => ({
      id: 'pay-1',
      orderId: 'ord-1',
      gatewayCode: 'bkash',
      amount: 1200,
      accountId: 'acc-bank',
      status: 'PAID',
      recordedBy: 'staff:user-1',
      recordedAt: new Date('2026-10-12T06:00:00.000Z'),
      createdAt: new Date('2026-10-12T06:00:00.000Z'),
      journalEntryId: null,
      reversalJournalEntryId: null,
      ...over,
    });

    it('posts one balanced receipt, and a retry adopts it instead of re-posting', async () => {
      const { db, journal } = makeHarness();
      db.orders.push({
        id: 'ord-1',
        displayId: 'ORD-260101-0002',
        paymentOptionType: 'FULL_PAYMENT',
      });
      db.payments.push(orderPayment());

      const first = await journal.tryPostOrderPayment('pay-1');
      const retry = await journal.tryPostOrderPayment('pay-1');

      expect(first).toEqual({ status: 'posted', journalEntryId: 'je-1' });
      expect(retry).toEqual({ status: 'adopted', journalEntryId: 'je-1' });
      expect(db.entries).toHaveLength(1);
      expect(db.payments).toHaveLength(1);

      // Dr the gateway's mapped asset leaf / Cr the clearing account the COD
      // settlement also credits — one receipt convention, not two.
      expect(lineSpec(db, 'je-1')).toEqual([
        { code: 'bank-main', debit: 1200, credit: 0 },
        { code: 'courier-cod-clearing', debit: 0, credit: 1200 },
      ]);
      expect(db.entries[0].referenceNo).toBe('PAY-pay-1');
      expect(db.payments[0].journalEntryId).toBe('je-1');
    });

    it('a payment that is not PAID posts nothing', async () => {
      const { db, journal } = makeHarness();
      db.orders.push({
        id: 'ord-1',
        displayId: 'ORD-260101-0002',
        paymentOptionType: 'FULL_PAYMENT',
      });
      db.payments.push(orderPayment({ status: 'PENDING' }));

      expect(await journal.tryPostOrderPayment('pay-1')).toEqual({
        status: 'skipped',
        journalEntryId: null,
        reason: 'payment_not_recorded',
      });
      expect(db.entries).toHaveLength(0);
    });

    it('a posted receipt that is reversed afterwards nets to zero', async () => {
      const { db, journal } = makeHarness();
      db.orders.push({
        id: 'ord-1',
        displayId: 'ORD-260101-0002',
        paymentOptionType: 'FULL_PAYMENT',
      });
      db.payments.push(orderPayment());

      await journal.tryPostOrderPayment('pay-1');
      const reversed = await journal.tryReverseOrderPayment(
        'pay-1',
        'payment status set to FAILED',
      );

      expect(reversed.status).toBe('reversed');
      expect(db.entries).toHaveLength(2);
      expect(lineSpec(db, 'je-2')).toEqual([
        { code: 'bank-main', debit: 0, credit: 1200 },
        { code: 'courier-cod-clearing', debit: 1200, credit: 0 },
      ]);
      expect(netOn(db, 'acc-bank')).toBe(0);
      expect(netOn(db, accountIdOf(db, 'courier-cod-clearing'))).toBe(0);
    });
  });

  describe('refund mirror', () => {
    it('mirrors the original receipt (Dr clearing / Cr asset) using the refund row account', async () => {
      const { db, journal } = makeHarness();
      db.orders.push({
        id: 'ord-1',
        displayId: 'ORD-260101-0003',
        paymentOptionType: 'FULL_PAYMENT',
      });
      db.payments.push({
        id: 'pay-refund',
        orderId: 'ord-1',
        gatewayCode: 'bkash',
        amount: -400,
        accountId: 'acc-bank',
        status: 'PAID',
        recordedBy: 'staff:user-2',
        recordedAt: new Date('2026-10-18T06:00:00.000Z'),
        createdAt: new Date('2026-10-18T06:00:00.000Z'),
        journalEntryId: null,
        reversalJournalEntryId: null,
      });

      const outcome = await journal.tryPostRefundMirror('pay-refund', 'pay-original');

      expect(outcome.status).toBe('posted');
      // The mirror of "Dr asset / Cr clearing" is "Dr clearing / Cr asset".
      expect(lineSpec(db, 'je-1')).toEqual([
        { code: 'courier-cod-clearing', debit: 400, credit: 0 },
        { code: 'bank-main', debit: 0, credit: 400 },
      ]);
      expect(totals(db)).toEqual({ debit: 400, credit: 400 });
    });
  });

  describe('supplier payments', () => {
    it('posts Dr supplier payable / Cr the mapped asset leaf', async () => {
      const { db, journal } = makeHarness();
      db.suppliers.push({ id: 'sup-1', name: 'Acme Supplies' });
      db.supplierPayments.push({
        id: 'sp-1',
        supplierId: 'sup-1',
        amount: 6000,
        paymentMethod: 'bank',
        accountId: 'acc-bank',
        paidAt: new Date('2026-10-14T06:00:00.000Z'),
        journalEntryId: null,
        reversalJournalEntryId: null,
      });

      const outcome = await journal.tryPostSupplierPayment('sp-1');

      expect(outcome.status).toBe('posted');
      expect(
        db.accounts.find((a) => a.code === SUPPLIER_PAYABLE_ACCOUNT_CODE),
      ).toMatchObject({ type: 'liability', isGroup: false });
      expect(lineSpec(db, 'je-1')).toEqual([
        { code: SUPPLIER_PAYABLE_ACCOUNT_CODE, debit: 6000, credit: 0 },
        { code: 'bank-main', debit: 0, credit: 6000 },
      ]);
    });
  });

  describe('Part 3 — the accounting P&L sees a paid payslip, exactly once', () => {
    const payrollPayment = () => ({
      id: 'pp-1',
      payslipId: 'ps-1',
      amount: 10000,
      method: 'cash',
      accountId: 'acc-bank',
      recordedById: 'user-1',
      paidAt: new Date('2026-10-15T06:00:00.000Z'),
      voidedAt: null,
      journalEntryId: null,
      reversalJournalEntryId: null,
    });

    it("a paid payslip's cost is visible in the accounting P&L for its period", async () => {
      const { db, journal, accounting } = makeHarness();
      db.payrollPayments.push(payrollPayment());

      await journal.tryPostPayrollPayment('pp-1');
      const periodId = db.periods[0].id;

      const pnl = await accounting.profitAndLoss(periodId);
      const salary = pnl.expenseAccounts.find(
        (a: any) => a.account_code === SALARY_EXPENSE_ACCOUNT_CODE,
      );

      // It flows from the JOURNAL — nothing else posts to this leaf.
      expect(salary.balance).toBe(10000);
      expect(pnl.totalExpense).toBe(10000);
      expect(pnl.totalIncome).toBe(0);
      expect(pnl.netProfit).toBe(-10000);

      // Books stay balanced: the trial balance nets to zero.
      const tb = await accounting.trialBalance(periodId);
      expect(tb.totalDebit).toBe(tb.totalCredit);
    });

    it('voiding removes the cost from the period (net zero), never deletes the entry', async () => {
      const { db, journal, accounting } = makeHarness();
      db.payrollPayments.push(payrollPayment());
      await journal.tryPostPayrollPayment('pp-1');
      const periodId = db.periods[0].id;

      await journal.tryReversePayrollPayment('pp-1', 'voided by HR');

      const pnl = await accounting.profitAndLoss(periodId);
      expect(
        pnl.expenseAccounts.find(
          (a: any) => a.account_code === SALARY_EXPENSE_ACCOUNT_CODE,
        ).balance,
      ).toBe(0);
      expect(pnl.totalExpense).toBe(0);
      expect(pnl.netProfit).toBe(0);
      // Append-only: both entries survive.
      expect(db.entries).toHaveLength(2);
    });
  });

  describe('backfill for payments recorded before Phase 2', () => {
    function seeded() {
      const harness = makeHarness();
      const { db } = harness;
      db.orders.push({
        id: 'ord-1',
        displayId: 'ORD-260101-0009',
        paymentOptionType: 'FULL_PAYMENT',
      });
      db.orders.push({
        id: 'ord-cod',
        displayId: 'ORD-260101-0010',
        paymentOptionType: 'CASH_ON_DELIVERY',
      });
      db.payslips.push({ id: 'ps-1', periodKey: '2026-10' });
      db.suppliers.push({ id: 'sup-1', name: 'Acme Supplies' });
      // Recorded before the feature shipped — all three carry no anchor.
      db.payrollPayments.push({
        id: 'pp-old',
        payslipId: 'ps-1',
        amount: 7000,
        accountId: 'acc-bank',
        paidAt: new Date('2026-10-05T06:00:00.000Z'),
        voidedAt: null,
        journalEntryId: null,
        reversalJournalEntryId: null,
      });
      db.supplierPayments.push({
        id: 'sp-old',
        supplierId: 'sup-1',
        amount: 3000,
        accountId: 'acc-bank',
        paidAt: new Date('2026-10-06T06:00:00.000Z'),
        journalEntryId: null,
        reversalJournalEntryId: null,
      });
      db.payments.push({
        id: 'pay-old',
        orderId: 'ord-1',
        gatewayCode: 'bkash',
        amount: 1000,
        accountId: 'acc-bank',
        status: 'PAID',
        recordedAt: new Date('2026-10-07T06:00:00.000Z'),
        createdAt: new Date('2026-10-07T06:00:00.000Z'),
        journalEntryId: null,
        reversalJournalEntryId: null,
      });
      db.payments.push({
        id: 'pay-cod-old',
        orderId: 'ord-cod',
        gatewayCode: 'cash',
        amount: 850,
        accountId: 'acc-bank',
        status: 'PAID',
        recordedAt: new Date('2026-10-08T06:00:00.000Z'),
        createdAt: new Date('2026-10-08T06:00:00.000Z'),
        journalEntryId: null,
        reversalJournalEntryId: null,
      });
      db.payments.push({
        id: 'pay-unmapped',
        orderId: 'ord-1',
        gatewayCode: 'bkash',
        amount: 500,
        accountId: null,
        status: 'PAID',
        recordedAt: new Date('2026-10-09T06:00:00.000Z'),
        createdAt: new Date('2026-10-09T06:00:00.000Z'),
        journalEntryId: null,
        reversalJournalEntryId: null,
      });
      return harness;
    }

    it('dry run reports the candidates and writes NOTHING', async () => {
      const { db, journal } = seeded();

      const report = await journal.backfillRecordedPayments({ dryRun: true });

      expect(report.dryRun).toBe(true);
      expect(report.scanned).toBe(4); // 1 payroll + 1 supplier + 2 receipts
      expect(report.posted).toBe(0);
      expect(report.items.every((i) => i.outcome.reason === 'dry_run')).toBe(true);
      expect(report.items.map((i) => i.kind).sort()).toEqual([
        'order',
        'order',
        'payroll',
        'supplier',
      ]);
      expect(db.entries).toHaveLength(0);
      expect(db.payrollPayments[0].journalEntryId).toBeNull();
    });

    it('posts exactly one journal per recorded payment and is idempotent', async () => {
      const { db, journal } = seeded();

      const first = await journal.backfillRecordedPayments();

      expect(first.dryRun).toBe(false);
      // The COD receipt is scanned and reported, never posted.
      expect(first.posted).toBe(3);
      expect(first.skipped).toBe(1);
      expect(first.items.find((i) => i.paymentId === 'pay-cod-old')?.outcome)
        .toEqual({
          status: 'skipped',
          journalEntryId: null,
          reason: COD_SKIP_REASON,
        });
      // The unmapped row is not even a candidate.
      expect(first.items.map((i) => i.paymentId)).not.toContain('pay-unmapped');

      expect(db.entries).toHaveLength(3);
      expect(db.payrollPayments[0].journalEntryId).toBeTruthy();
      expect(db.supplierPayments[0].journalEntryId).toBeTruthy();

      // The COD row is still unanchored (it is never posted), so it is still
      // reported as a candidate — but nothing new is WRITTEN.
      const second = await journal.backfillRecordedPayments();
      expect(second.scanned).toBe(1);
      expect(second.posted).toBe(0);
      expect(second.adopted).toBe(0);
      expect(db.entries).toHaveLength(3);
    });

    it('bounds the scan by limit', async () => {
      const { journal } = seeded();
      const report = await journal.backfillRecordedPayments({
        dryRun: true,
        limit: 1,
      });
      // One per kind, not one overall.
      expect(report.scanned).toBe(3);
    });
  });

  describe('accounting-disabled deployments', () => {
    it('posts nothing and says so, for every payment kind', async () => {
      const { db, journal } = makeHarness({ accountingEnabled: false });
      db.payrollPayments.push({
        id: 'pp-1',
        amount: 100,
        accountId: 'acc-bank',
        paidAt: new Date('2026-10-15T00:00:00.000Z'),
        voidedAt: null,
        journalEntryId: null,
        reversalJournalEntryId: null,
      });

      expect(await journal.tryPostPayrollPayment('pp-1')).toEqual({
        status: 'skipped',
        journalEntryId: null,
        reason: 'accounting_disabled',
      });
      expect(db.entries).toHaveLength(0);
      expect(db.accounts).toHaveLength(1); // no leaf created either
    });
  });
});
