// ── P4 cost semantics + §7 projection tests, incl. the zero-cost authority rule.

import {
  projectOrderCost,
  shippingCostWrite,
  effectiveCourierCost,
  isContributingRow,
  type ProjectionRowInput,
} from '../cost-projection';
import { CourierSettlementCostService } from '../cost-projection.service';

const row = (over: Partial<ProjectionRowInput> = {}): ProjectionRowInput => ({
  invoiceState: 'ACCOUNTING_POSTED',
  rowClass: 'DATA',
  orderId: 'o1',
  supersededByRowId: null,
  effectiveCharges: 100,
  declaredCharges: 100,
  ...over,
});

describe('§7 projection — authority incl. zero', () => {
  it('writes 0 over a manual 180 with source courier_invoice and raises ZERO_COST_REVIEW', () => {
    const result = projectOrderCost('o1', [
      row({ effectiveCharges: 0, declaredCharges: 0 }),
    ]);
    expect(result.projection).toBe(0);
    expect(result.hasContributingRows).toBe(true);
    expect(result.zeroCostReview).toBe(true);
    expect(shippingCostWrite(result)).toEqual({ shippingCost: 0, shippingCostSource: 'courier_invoice' });
  });

  it('non-zero projection overwrites a manual value', () => {
    const result = projectOrderCost('o1', [row({ effectiveCharges: 180, declaredCharges: 180 })]);
    expect(shippingCostWrite(result)).toEqual({ shippingCost: 180, shippingCostSource: 'courier_invoice' });
    expect(result.zeroCostReview).toBe(false);
  });

  it('leaves the order untouched when no row contributes', () => {
    expect(shippingCostWrite(projectOrderCost('o1', []))).toBeNull();
  });

  it('excludes superseded rows', () => {
    const result = projectOrderCost('o1', [
      row({ effectiveCharges: 100 }),
      row({ effectiveCharges: 999, supersededByRowId: 'r-new' }),
    ]);
    expect(result.projection).toBe(100);
  });

  it('excludes rows from non-finalized invoices', () => {
    const result = projectOrderCost('o1', [
      row({ invoiceState: 'READY_FOR_REVIEW', effectiveCharges: 50 }),
      row({ invoiceState: 'ACCOUNTING_POSTED', effectiveCharges: 40 }),
    ]);
    expect(result.projection).toBe(40);
  });

  it('excludes non-DATA rows and other orders', () => {
    const result = projectOrderCost('o1', [
      row({ rowClass: 'FOOTER', effectiveCharges: 500 }),
      row({ orderId: 'o2', effectiveCharges: 500 }),
      row({ effectiveCharges: 70 }),
    ]);
    expect(result.projection).toBe(70);
  });

  it('recomputes the union across two invoices (never accumulates)', () => {
    // partial 600 (fee 100) + completion (fee 40) → 140, not 100 or 40 or 240
    const result = projectOrderCost('o1', [
      row({ effectiveCharges: 100 }),
      row({ effectiveCharges: 40 }),
    ]);
    expect(result.projection).toBe(140);
    expect(shippingCostWrite(result)!.shippingCost).toBe(140);
  });

  it('only counts contributing rows for the zero-charge suspicion', () => {
    const result = projectOrderCost('o1', [
      row({ effectiveCharges: 0, declaredCharges: 0 }),
      row({ effectiveCharges: 0, declaredCharges: 0, supersededByRowId: 'x' }),
      row({ effectiveCharges: 0, declaredCharges: 50 }),
    ]);
    // projection 0, one non-superseded zero-declared row → review
    expect(result.zeroDeclaredChargeRows).toBe(1);
    expect(result.zeroCostReview).toBe(true);
  });
});

describe('effectiveCourierCost (§7 overlay)', () => {
  it('uses the override when present, else the normalized value', () => {
    expect(effectiveCourierCost(100)).toBe(100);
    expect(effectiveCourierCost(100, 200)).toBe(200);
    expect(effectiveCourierCost(100, 0)).toBe(0);
    expect(effectiveCourierCost(100, null)).toBe(100);
  });
});

describe('isContributingRow (§7 inclusion rules)', () => {
  it('requires finalized + DATA + matching order + not superseded', () => {
    expect(isContributingRow(row(), 'o1')).toBe(true);
    expect(isContributingRow(row({ invoiceState: 'DISCARDED' }), 'o1')).toBe(false);
    expect(isContributingRow(row({ rowClass: 'SUMMARY' }), 'o1')).toBe(false);
    expect(isContributingRow(row(), 'o2')).toBe(false);
    expect(isContributingRow(row({ supersededByRowId: 'x' }), 'o1')).toBe(false);
  });
});

describe('writeBackMany (§14 batched cost write-back)', () => {
  function makePrisma() {
    const orderUpdates: any[] = [];
    const exceptionsCreated: any[] = [];
    const prisma: any = {
      courierSettlementRow: {
        findMany: jest.fn().mockResolvedValue([
          { invoiceId: 'inv-1', invoice: { state: 'ACCOUNTING_POSTED' }, rowClass: 'DATA', orderId: 'o1', supersededByRowId: null, effectiveCharges: 180, declaredCharges: 180 },
          { invoiceId: 'inv-1', invoice: { state: 'ACCOUNTING_POSTED' }, rowClass: 'DATA', orderId: 'o2', supersededByRowId: null, effectiveCharges: 0, declaredCharges: 0 },
        ]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'o1', shippingCost: 999, shippingCostSource: 'manual', timeline: [] },
          { id: 'o2', shippingCost: 180, shippingCostSource: 'manual', timeline: [] },
        ]),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          orderUpdates.push({ id: where.id, data });
          return Promise.resolve({});
        }),
      },
      courierSettlementException: {
        createMany: jest.fn().mockImplementation(({ data }: any) => {
          exceptionsCreated.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
    };
    return { prisma, orderUpdates, exceptionsCreated };
  }

  it('reads rows and orders once for all orders, writes every changed order', async () => {
    const { prisma, orderUpdates, exceptionsCreated } = makePrisma();
    const svc = new CourierSettlementCostService(prisma);

    const res = await svc.writeBackMany(['o1', 'o2'], undefined, 'u1');

    expect(prisma.courierSettlementRow.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.courierSettlementRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: { in: ['o1', 'o2'] } } }),
    );
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
    expect(res.map((r) => r.orderId)).toEqual(['o1', 'o2']);
    expect(orderUpdates.map((u) => u.id).sort()).toEqual(['o1', 'o2']);
    expect(orderUpdates.find((u) => u.id === 'o1')?.data.shippingCost).toBe(180);
    // o2 projects 0 → ONE batched ZERO_COST_REVIEW, invoiceId from the loaded rows
    expect(exceptionsCreated).toHaveLength(1);
    expect(exceptionsCreated[0]).toMatchObject({
      ruleId: 'ZERO_COST_REVIEW',
      orderId: 'o2',
      invoiceId: 'inv-1',
      severity: 'yellow',
    });
  });

  it('returns nothing (and writes nothing) when no row contributes', async () => {
    const { prisma } = makePrisma();
    prisma.courierSettlementRow.findMany.mockResolvedValue([]);
    const svc = new CourierSettlementCostService(prisma);

    const single = await svc.writeBack('o1');
    expect(single).toBeNull();
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.courierSettlementException.createMany).not.toHaveBeenCalled();
  });

  it('no-ops on an empty order id list without touching the database', async () => {
    const { prisma } = makePrisma();
    const svc = new CourierSettlementCostService(prisma);
    expect(await svc.writeBackMany([])).toEqual([]);
    expect(prisma.courierSettlementRow.findMany).not.toHaveBeenCalled();
  });
});