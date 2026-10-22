// ── Analytics P&L × payroll cost — no-double-count proof (Phase 2) ───────────
//
// TASK: prove mechanically that the analytics P&L surface cannot double count
// payroll cost once Phase 2's double-entry journals (Dr salary expense /
// Cr asset) exist.
//
// TRACED CODE PATH (Part 1, verified — the basis of this proof):
//
//   • Payroll cost is written as an `Expense` row by
//     expenses/compensation-expense.service.ts (keys @@unique([sourceType,
//     sourceId]), createdBy: 'system', journalEntryId stays NULL). Its callers
//     are payroll.service.ts:564 (approvePayslip) and payroll.service.ts:642
//     (setStatus('approved')) with sourceType 'payroll';
//     commissions.service.ts:438 ('commission'); commission-engine.service.ts:300
//     ('commission_v2'). Reversals insert a NEW negative row with
//     sourceType '<type>_reversal'.
//   • The analytics P&L is analytics-pnl.service.ts. buildReport() fetches
//     expenses at :924
//       this.prisma.expense.findMany({ where: { expenseDate: { gte, lte } },
//         select: { amount: true, taxAmount: true, expenseDate: true } })
//     and computePnl() accumulates them at :529-534
//       let opex = 0;
//       for (const expense of input.expenses)
//         if (inRange(expense.expenseDate, range))
//           opex += expense.amount + expense.taxAmount;
//     `opex` is emitted as the operatingExpenses output line at :603 and the
//     enveloped line at :1093; it drives operatingProfit (:552-555) and
//     netProfit (:556-559). The controller's GET /analytics/pnl
//     (business-analytics.controller.ts:65) calls getPnl() -> buildReport().
//   • PayslipStatus values are lowercase (draft|reviewed|approved|partially_paid
//     |paid|cancelled) exactly as hr-payments.service.ts writes them; a PAID
//     payslip's cost is already on the Expense table at the `approved`
//     transition, and HrPaymentsService refuses a payment before `approved`, so
//     the Expense row always predates the PayrollPayment.
//
// WHY THIS IS A VALID PROOF: the P&L surface reads ONLY the Expense table — no
// journal delegate and no PayrollPayment delegate. The Phase-2 journals
// (Dr salary expense / Cr asset) are therefore structurally invisible to the
// P&L and cannot add a second salary cost. These tests make that structural
// claim mechanical: the journal / payrollPayment delegates THROW if ever
// touched, every accessed delegate is recorded and asserted, and the reported
// payload is proven identical whether or not payroll-payment data is present.
import { Test } from '@nestjs/testing';
import { AnalyticsPnlService } from '../analytics-pnl.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsFilterService } from '../analytics-filter.service';
import { AnalyticsFulfillmentService } from '../analytics-fulfillment.service';
import { CacheService } from '../../cache/cache.service';

const RANGE = {
  start: new Date('2026-09-01T00:00:00+06:00'),
  end: new Date('2026-09-30T17:59:59.999Z'),
  periodDays: 30,
  granularity: 'day',
  comparison: {
    prevStart: new Date('2026-08-01T00:00:00+06:00'),
    prevEnd: new Date('2026-08-31T17:59:59.999Z'),
  },
};

const EXPENSE_DATE = new Date('2026-09-15T00:00:00+06:00');

// A delivered order so the ladder is non-empty (empty ⇒ no_data / null values);
// otherwise the P&L cannot report a numeric operatingExpenses at all.
function deliveredOrder() {
  return {
    id: 'o1',
    total: 1060,
    subtotal: 1000,
    shippingCharge: 60,
    discount: 0,
    discountType: 'flat',
    status: { name: 'Delivered' },
    timeline: [{ status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' }],
    createdAt: new Date('2026-09-02T10:00:00+06:00'),
    paymentOptionType: 'FULL_PAYMENT',
    customerId: null,
    customerPhone: null,
    guestPhone: null,
    shippingCost: 50,
    shippingCostSource: 'manual',
    items: [
      {
        productId: 'p1',
        variantId: null,
        price: 500,
        quantity: 2,
        costSnapshot: 300,
        costType: 'actual',
      },
    ],
    payments: [],
    refunds: [],
    returns: [],
    dispatches: [],
  };
}

/**
 * A system-posted payroll Expense row, exactly as compensation-expense.service
 * writes it: sourceType 'payroll', createdBy 'system', journalEntryId NULL.
 * Only amount / taxAmount / expenseDate are read by the P&L select; the extra
 * fields are carried for legibility.
 */
function payrollExpense(opts: {
  amount: number;
  taxAmount?: number;
  sourceId?: string;
  expenseDate?: Date;
  sourceType?: string;
}) {
  return {
    id: `exp-${opts.sourceId ?? 'x'}`,
    amount: opts.amount,
    taxAmount: opts.taxAmount ?? 0,
    expenseDate: opts.expenseDate ?? EXPENSE_DATE,
    sourceType: opts.sourceType ?? 'payroll',
    sourceId: opts.sourceId ?? 'payslip-1',
    createdBy: 'system',
    journalEntryId: null,
  };
}

interface DoubleOptions {
  orders?: any[];
  expenses?: any[];
  /** Journal delegates throw on access (default true). */
  guardJournals?: boolean;
  /** payrollPayment delegate throws on access (default true). */
  guardPayrollPayment?: boolean;
  /** Rows the payrollPayment / payslip delegates return when unguarded. */
  payrollPayments?: any[];
  payslips?: any[];
}

/**
 * A Proxy-based PrismaService double that (a) THROWS on any access to the
 * journal / payrollPayment delegates and (b) records every accessed delegate
 * key so the test can assert exactly which delegates the report read.
 */
function makePrismaDoubles(opts: DoubleOptions = {}) {
  const accessed: string[] = [];
  const guardJournals = opts.guardJournals ?? true;
  const guardPayrollPayment = opts.guardPayrollPayment ?? true;

  const forbidden = new Set<string>();
  if (guardJournals) {
    forbidden.add('journalEntry');
    forbidden.add('journalEntryLine');
  }
  if (guardPayrollPayment) forbidden.add('payrollPayment');

  const delegates: Record<string, any> = {
    order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    marketingConsumption: { findMany: jest.fn().mockResolvedValue([]) },
    expense: { findMany: jest.fn().mockResolvedValue(opts.expenses ?? []) },
  };
  if (opts.payrollPayments || opts.payslips) {
    delegates.payrollPayment = {
      findMany: jest.fn().mockResolvedValue(opts.payrollPayments ?? []),
    };
    delegates.payslip = {
      findMany: jest.fn().mockResolvedValue(opts.payslips ?? []),
    };
  }

  // Safety net for any delegate this surface is not expected to touch.
  const emptyDelegate = new Proxy(
    {},
    { get: () => jest.fn().mockResolvedValue([]) },
  );

  const prisma: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'then') return undefined; // never a thenable
        accessed.push(prop);
        if (forbidden.has(prop)) {
          throw new Error(`AnalyticsPnL must never read the ${prop} delegate`);
        }
        return delegates[prop] ?? emptyDelegate;
      },
    },
  );

  return { prisma, accessed };
}

async function buildService(prisma: any): Promise<AnalyticsPnlService> {
  const filters = {
    resolveContext: jest.fn().mockReturnValue({ range: RANGE, filters: {} }),
    buildOrderWhere: jest.fn().mockReturnValue({ trashedAt: null }),
    resolveMarketingOrderIds: jest.fn(),
    segmentOf: jest.fn(),
  };
  const fulfillment = {
    buildSettlementSource: jest.fn().mockReturnValue({
      getCodCollection: jest.fn().mockReturnValue({ state: 'unavailable' }),
    }),
  };
  const cache = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AnalyticsPnlService,
      { provide: PrismaService, useValue: prisma },
      { provide: AnalyticsFilterService, useValue: filters },
      { provide: CacheService, useValue: cache },
      { provide: AnalyticsFulfillmentService, useValue: fulfillment },
    ],
  }).compile();

  return moduleRef.get(AnalyticsPnlService);
}

describe('analytics P&L — payroll cost cannot be double counted (Phase 2)', () => {
  it('sanity: the guard double really throws on any journal / payrollPayment access', () => {
    const { prisma } = makePrismaDoubles({});
    expect(() => prisma.journalEntry).toThrow(/must never read/);
    expect(() => prisma.journalEntryLine).toThrow(/must never read/);
    expect(() => prisma.payrollPayment).toThrow(/must never read/);
  });

  it('1. journals are structurally invisible: report completes with throwing journal delegates, opex == exactly Σ(amount + tax) in range', async () => {
    const { prisma } = makePrismaDoubles({
      orders: [deliveredOrder()],
      expenses: [
        payrollExpense({ amount: 5000, taxAmount: 750, sourceId: 'payslip-1' }),
        // Out of range: SQL bounds it in production; computePnl guards it too.
        payrollExpense({
          amount: 9999,
          sourceId: 'payslip-old',
          expenseDate: new Date('2026-08-15T00:00:00+06:00'),
        }),
      ],
    });
    const service = await buildService(prisma);

    // Any touch of journalEntry / journalEntryLine / payrollPayment throws.
    const res = await service.getPnl({} as any);

    // Exactly the in-range Expense sum — the out-of-range row is not counted.
    expect(res.data.lines.operatingExpenses.value).toBe(5000 + 750);
    expect(res.data.lines.operatingExpenses.value).toBe(5750);
  });

  it('2. one system-posted payroll expense is counted exactly once; distinct sourceIds sum; the read is idempotent', async () => {
    const { prisma } = makePrismaDoubles({
      orders: [deliveredOrder()],
      expenses: [payrollExpense({ amount: 4000, sourceId: 'payslip-1' })],
    });
    const service = await buildService(prisma);

    const once = await service.getPnl({} as any);
    expect(once.data.lines.operatingExpenses.value).toBe(4000);

    // Re-running over the same data yields the same number.
    const again = await service.getPnl({} as any);
    expect(again.data.lines.operatingExpenses).toEqual(
      once.data.lines.operatingExpenses,
    );

    // Two rows for DIFFERENT payslips/sourceIds sum — no aggregation-by-id
    // weirdness (the surface simply sums every fetched row).
    const { prisma: two } = makePrismaDoubles({
      orders: [deliveredOrder()],
      expenses: [
        payrollExpense({ amount: 4000, sourceId: 'payslip-1' }),
        payrollExpense({ amount: 2500, sourceId: 'payslip-2' }),
      ],
    });
    const twoService = await buildService(two);
    const summed = await twoService.getPnl({} as any);
    expect(summed.data.lines.operatingExpenses.value).toBe(4000 + 2500);
  });

  it('3. payroll PAYMENTS add nothing: the reported payload is identical with/without a PayrollPayment row present', async () => {
    const baseExpenses = [payrollExpense({ amount: 4000, sourceId: 'payslip-1' })];

    // (a) Guarded run — reading payrollPayment / journal would throw.
    const { prisma: guarded } = makePrismaDoubles({
      orders: [deliveredOrder()],
      expenses: baseExpenses,
    });
    const guardedRes = await (await buildService(guarded)).getPnl({} as any);

    // (b) Same data PLUS a readable PayrollPayment + Payslip row — proving even
    // payroll-payment data the delegate COULD return is never consulted.
    const { prisma: withPayments, accessed } = makePrismaDoubles({
      orders: [deliveredOrder()],
      expenses: baseExpenses,
      guardPayrollPayment: false,
      payrollPayments: [
        {
          id: 'pp1',
          payslipId: 'payslip-1',
          amount: 4000,
          paidAt: EXPENSE_DATE,
          journalEntryId: 'je-1', // Phase-2 Dr salary expense / Cr asset
          reversalJournalEntryId: null,
        },
      ],
      payslips: [{ id: 'payslip-1', status: 'paid', netPay: 4000 }],
    });
    const paidRes = await (await buildService(withPayments)).getPnl({} as any);

    // Byte-identical reported payload; the expense line is still counted once.
    expect(paidRes.data).toEqual(guardedRes.data);
    expect(paidRes.data.lines.operatingExpenses).toEqual(
      guardedRes.data.lines.operatingExpenses,
    );
    expect(paidRes.data.lines.netProfit).toEqual(
      guardedRes.data.lines.netProfit,
    );
    expect(paidRes.data.lines.operatingExpenses.value).toBe(4000);

    // The service never even reached for the payroll-payment surface.
    expect(accessed).not.toContain('payrollPayment');
    expect(accessed).not.toContain('payslip');
  });

  it('4. the report path records only Expense/cash delegates — never a journal or payrollPayment delegate', async () => {
    const { prisma, accessed } = makePrismaDoubles({
      orders: [deliveredOrder()],
      expenses: [payrollExpense({ amount: 4000, sourceId: 'payslip-1' })],
    });
    const service = await buildService(prisma);
    await service.getPnl({} as any);

    // No journal delegate, no payrollPayment delegate, ever.
    expect(accessed).not.toContain('journalEntry');
    expect(accessed).not.toContain('journalEntryLine');
    expect(accessed).not.toContain('payrollPayment');
    // The expense table IS the only cost source.
    expect(accessed).toContain('expense');

    // Full recorded set on the P&L report path. `payment` IS read — but only as
    // the L3 cash-collected lens (buildReport :900: status PAID + order relation),
    // it is the order `Payment` model, never a payroll-cost source, and it
    // cannot carry salary cost into operatingExpenses (that comes solely from
    // the `expense` delegate). The literal "no payment delegate" clause holds
    // in full on the expenses report path (see test 5).
    expect(new Set(accessed)).toEqual(
      new Set(['order', 'payment', 'marketingConsumption', 'expense']),
    );
  });

  it('5. getExpensesSummary (GET /analytics/expenses) likewise reads ONLY the Expense delegate', async () => {
    const { prisma, accessed } = makePrismaDoubles({
      expenses: [
        {
          amount: 4000,
          taxAmount: 0,
          expenseDate: EXPENSE_DATE,
          sourceType: 'payroll',
          createdBy: 'system',
          category: {
            id: 'c-salaries',
            name: 'Salaries',
            expenseKind: 'fixed',
          },
        },
      ],
    });
    const service = await buildService(prisma);

    // getExpensesSummary has no declared return type and its internal
    // `cache.get(key)` call is untyped, so TS infers `{}` for the return;
    // widen to `any` at the call site (the response shape is asserted below).
    const res: any = await service.getExpensesSummary({} as any);

    expect(res.data.total).toBe(4000);
    // Absolutely no journal, payment, order or payrollPayment delegate is read.
    expect(accessed).toEqual(['expense']);
    for (const forbidden of [
      'journalEntry',
      'journalEntryLine',
      'payment',
      'payrollPayment',
    ]) {
      expect(accessed).not.toContain(forbidden);
    }
  });
});
