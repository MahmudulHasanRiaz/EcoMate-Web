// §3 / §14.4 — read models: invoice list, overview KPIs (stock vs flow basis),
// waterfall, exception rollups, the Σ-periods == current-effective invariant,
// and the COD balance drill-down (outstanding / payable / awaiting).

import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CourierSettlementOverviewService,
  DRAFT_INVOICE_STATES,
} from '../overview.service';

type Overrides = {
  invoices?: any[];
  flowRows?: any[];
  currentRows?: any[];
  orders?: any[];
  byState?: any[];
  exceptionGroups?: any[];
  shippingSum?: number | null;
};

async function makeSvc(o: Overrides = {}) {
  const invoices = o.invoices ?? [];
  const flowRows = o.flowRows ?? [];
  const currentRows = o.currentRows ?? flowRows;
  const orders = o.orders ?? [];

  const prisma: any = {
    courierSettlementInvoice: {
      count: jest.fn().mockResolvedValue(invoices.length),
      findMany: jest.fn().mockResolvedValue(invoices),
      groupBy: jest
        .fn()
        .mockResolvedValue(
          o.byState ?? [{ state: 'ACCOUNTING_POSTED', _count: { _all: 2 } }],
        ),
    },
    courierSettlementException: {
      groupBy: jest
        .fn()
        .mockResolvedValue(
          o.exceptionGroups ?? [
            { severity: 'red', status: 'open', _count: { _all: 3 } },
            { severity: 'yellow', status: 'acknowledged', _count: { _all: 4 } },
            { severity: 'yellow', status: 'open', _count: { _all: 2 } },
          ],
        ),
    },
    courierSettlementRow: {
      findMany: jest.fn().mockImplementation(async (args: any) => {
        // Only the flow query is date-scoped through invoice.finalizedAt.
        return args?.where?.invoice?.finalizedAt ? flowRows : currentRows;
      }),
      // Flow + invariant read via DB-side aggregates now (§14/§16).
      aggregate: jest.fn().mockImplementation(async (args: any) => {
        const isFlow = !!args?.where?.invoice?.finalizedAt;
        const list = isFlow ? flowRows : currentRows;
        if (args?.where?.effectiveNet?.gt != null) {
          return {
            _sum: {
              effectiveNet:
                list.filter((r: any) => r.effectiveNet > 0).reduce((s: number, r: any) => s + r.effectiveNet, 0) || 0,
            },
          };
        }
        if (args?.where?.effectiveNet?.lt != null) {
          return {
            _sum: {
              effectiveNet:
                list.filter((r: any) => r.effectiveNet < 0).reduce((s: number, r: any) => s + r.effectiveNet, 0) || 0,
            },
          };
        }
        const charges = list.reduce((s: number, r: any) => s + r.effectiveCharges, 0);
        if (args?._sum?.effectiveCollected != null) {
          return {
            _sum: {
              effectiveCollected: list.reduce((s: number, r: any) => s + r.effectiveCollected, 0),
              effectiveCharges: charges,
              effectiveNet: list.reduce((s: number, r: any) => s + r.effectiveNet, 0),
            },
          };
        }
        return { _sum: { effectiveCharges: charges } };
      }),
    },
    order: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { shippingCharge: o.shippingSum ?? null } }),
      findMany: jest.fn().mockResolvedValue(orders),
    },
  };

  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementOverviewService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();

  return { svc: mod.get(CourierSettlementOverviewService), prisma };
}

describe('CourierSettlementOverviewService.listInvoices', () => {
  it('draft=true selects only the resumable draft states', async () => {
    const { svc, prisma } = await makeSvc({ invoices: [{ id: 'a', _count: { exceptions: 0 } }] });
    await svc.listInvoices({ draft: true });
    expect(prisma.courierSettlementInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { state: { in: DRAFT_INVOICE_STATES } } }),
    );
  });

  it('the default list applies no state filter (drafts stay resumable)', async () => {
    const { svc, prisma } = await makeSvc({ invoices: [{ id: 'a', _count: { exceptions: 0 } }] });
    await svc.listInvoices({});
    expect(prisma.courierSettlementInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('caps the page size at 100 and reports truthful pagination meta', async () => {
    const { svc } = await makeSvc({ invoices: [{ id: 'a', _count: { exceptions: 0 } }] });
    const res = await svc.listInvoices({ page: 1, limit: 500 });
    expect(res.meta).toEqual({ page: 1, limit: 100, total: 1, pages: 1 });
  });
});

describe('CourierSettlementOverviewService.getOverview (§3 flow KPIs)', () => {
  const flowRows = [
    { effectiveCollected: 600, effectiveCharges: 60, effectiveNet: 540 },
    { effectiveCollected: 400, effectiveCharges: 40, effectiveNet: 360 },
    { effectiveCollected: 0, effectiveCharges: 20, effectiveNet: -20 },
  ];

  it('computes the waterfall from effective rows and splits cash by sign', async () => {
    const { svc } = await makeSvc({ flowRows });
    const res = await svc.getOverview({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.waterfall).toEqual({
      expected: 1000,
      collected: 1000,
      charges: 120,
      net: 880,
      cashReceived: 900,
      cashDisbursed: 20,
    });
    expect(res.kpis.settledThisPeriod).toEqual({
      net: 880,
      cashReceived: 900,
      cashDisbursed: 20,
    });
    expect(res.kpis.courierCost).toBe(120);
  });

  it('derives shipping margin from the order-side charge minus courier cost', async () => {
    const { svc } = await makeSvc({ flowRows, shippingSum: 250 });
    const res = await svc.getOverview({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.kpis.shippingMargin).toBe(130);
  });

  it('rolls up exceptions by severity and by open status', async () => {
    const { svc } = await makeSvc({ flowRows });
    const res = await svc.getOverview({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.kpis.exceptions).toEqual({ red: 3, yellow: 6, open: 5 });
  });

  it('reports invoices grouped by state for the dashboard tiles', async () => {
    const { svc } = await makeSvc({ flowRows });
    const res = await svc.getOverview({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.invoicesByState).toEqual({ ACCOUNTING_POSTED: 2 });
  });

  it('holds the Σ-periods == current-effective invariant when the range covers everything', async () => {
    const { svc } = await makeSvc({ flowRows, currentRows: flowRows });
    const res = await svc.getOverview({ from: '2026-01-01', to: '2026-12-31' });
    expect(res.invariant).toEqual({
      currentEffectiveCharges: 120,
      periodCharges: 120,
      equal: true,
    });
  });

  it('exposes a basis mismatch instead of hiding it when the range is partial', async () => {
    const { svc, prisma } = await makeSvc({
      flowRows: [{ effectiveCollected: 400, effectiveCharges: 40, effectiveNet: 360 }],
      currentRows: [
        { effectiveCollected: 600, effectiveCharges: 60, effectiveNet: 540 },
        { effectiveCollected: 400, effectiveCharges: 40, effectiveNet: 360 },
      ],
    });
    const res = await svc.getOverview({ from: '2026-06-01', to: '2026-06-30' });
    expect(res.invariant).toEqual({
      currentEffectiveCharges: 100,
      periodCharges: 40,
      equal: false,
    });
    // The flow query is date-scoped; the invariant query is not.
    expect(prisma.courierSettlementRow.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invoice: expect.objectContaining({
            state: expect.objectContaining({ in: expect.any(Array) }),
          }),
        }),
      }),
    );
  });
});

describe('CourierSettlementOverviewService.getBalances (§3 stock)', () => {
  const codOrder = (id: string, total: number, rows: any[], payments: any[] = []) => ({
    id,
    displayId: id.toUpperCase(),
    total,
    payments,
    status: { name: 'Delivered' },
    courierSettlementRows: rows,
  });

  it('sums COD outstanding as Σ per-order positions (drill-down adds up)', async () => {
    const { svc } = await makeSvc({
      orders: [
        // Expected 1000, courier kept 100, remitted 900 → position 0.
        codOrder('ord1', 1000, [
          { effectiveCollected: 1000, effectiveCharges: 100, effectiveNet: 900, invoiceId: 'i1' },
        ]),
        // Never settled → the whole expected amount is outstanding.
        codOrder('ord2', 500, []),
        // Over-collected by 50 → payable to courier, not outstanding.
        codOrder('ord3', 1000, [
          { effectiveCollected: 1000, effectiveCharges: 100, effectiveNet: 950, invoiceId: 'i1' },
        ]),
      ],
    });
    const res = await svc.getBalances({});
    expect(res.kpis.outstandingCod).toBe(500);
    expect(res.kpis.awaitingSettlement).toBe(500);
    expect(res.kpis.payableToCourier).toBe(50);
    const perOrder = Object.fromEntries(res.orders.map((o) => [o.displayId, o]));
    expect(perOrder.ORD1.outstandingCod).toBe(0);
    expect(perOrder.ORD2.outstandingCod).toBe(500);
    expect(perOrder.ORD3.payableToCourier).toBe(50);
    expect(res.orders.reduce((s, o) => s + o.outstandingCod, 0)).toBe(res.kpis.outstandingCod);
  });

  it('prefers cash payments over Order.total for expected COD, and falls back when absent', async () => {
    const { svc, prisma } = await makeSvc({
      orders: [
        codOrder('ord1', 999, [], [{ amount: 770, gatewayCode: 'cash', status: 'PAID' }]),
        codOrder('ord2', 500, []),
      ],
    });
    await svc.getBalances({});
    const rows = prisma.order.findMany.mock.calls[0][0].select;
    expect(rows.payments).toBeDefined();
    const res = await svc.getBalances({});
    expect(res.orders.find((o) => o.displayId === 'ORD1')?.expectedCod).toBe(770);
    expect(res.orders.find((o) => o.displayId === 'ORD2')?.expectedCod).toBe(500);
  });

  it('buckets the unsettled COD stock into not-yet-collected vs collected-not-remitted', async () => {
    const { svc } = await makeSvc({
      orders: [
        codOrder('ord1', 500, []), // nothing collected yet
        codOrder('ord2', 1000, [
          // collected 1000 but courier net remitted only 900 → 100 stuck
          { effectiveCollected: 1000, effectiveCharges: 0, effectiveNet: 900, invoiceId: 'i1' },
        ]),
      ],
    });
    const res = await svc.getBalances({});
    expect(res.buckets.notYetCollected).toBe(500);
    expect(res.buckets.collectedNotRemitted).toBe(100);
  });

  it('scopes the stock query to the courier when one is selected', async () => {
    const { svc, prisma } = await makeSvc({ orders: [] });
    await svc.getBalances({ courier: 'pathao' });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dispatches: { some: { courier: 'pathao' } },
          paymentOptionType: 'CASH_ON_DELIVERY',
          trashedAt: null,
        }),
      }),
    );
  });
});
