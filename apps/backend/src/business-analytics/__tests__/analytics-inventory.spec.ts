/**
 * P8 inventory analytics tests (§2.8 defined period semantics + §7.1
 * inventory rows + §8.9-style reconstruction disclosure).
 *
 * Pure reconstruction math (lot + consume + restore) · closing_only
 * disclosure · turnover / DOI / sell-through / stock-out · movement classes
 * (P1 classifyMovement, never reimplemented) · periodDays always present ·
 * lost-sales honesty · delegation (closing value comes from
 * InventoryService.valuation — never a forked recompute).
 */
import {
  reconstructValueAt,
  reconcileInventoryBasis,
  computeAverageInventory,
  computeTurnover,
  computeInventoryDOI,
  computeSellThrough,
  computeStockoutDays,
  computeAging,
  computeLostSales,
  movementPolicyLabel,
  INVENTORY_VALUE_BASIS_STATEMENT,
  INVENTORY_CLOSING_ONLY_NOTE,
  MOVEMENT_POLICY_LABEL,
  LOST_SALES_NOTE,
  type LotHistoryInput,
} from '../analytics-inventory.service';
import { AnalyticsInventoryService } from '../analytics-inventory.service';
import { AnalyticsFilterService } from '../analytics-filter.service';
import { classifyMovement } from '../metric-contract';

const T0 = new Date('2026-08-01T00:00:00Z');
const T1 = new Date('2026-08-10T00:00:00Z');
const T2 = new Date('2026-08-20T00:00:00Z');

function lot(over: Partial<LotHistoryInput> = {}): LotHistoryInput {
  return {
    quantity: 100,
    unitCost: 10,
    receivedAt: T0,
    consumptions: [],
    restorations: [],
    ...over,
  };
}

// ─── reconstruction math (lot + consume + restore) ───────────────────────────

describe('reconstructValueAt', () => {
  it('values lots received on or before t at full quantity', () => {
    const v = reconstructValueAt(
      [lot({ quantity: 100, unitCost: 10, receivedAt: T0 })],
      T1,
    );
    expect(v.value).toBe(1000);
    expect(v.units).toBe(100);
    expect(v.lots).toBe(1);
  });

  it('excludes lots received after t', () => {
    const v = reconstructValueAt(
      [lot({ quantity: 100, unitCost: 10, receivedAt: T2 })],
      T1,
    );
    expect(v.value).toBe(0);
    expect(v.units).toBe(0);
    expect(v.lots).toBe(0);
  });

  it('subtracts consumptions created on or before t', () => {
    const v = reconstructValueAt(
      [
        lot({
          consumptions: [
            { quantity: 30, createdAt: T1 },
            { quantity: 100, createdAt: T2 },
          ],
        }),
      ],
      T1,
    );
    expect(v.value).toBe(700);
    expect(v.units).toBe(70);
  });

  it('adds back restorations created on or before t', () => {
    const v = reconstructValueAt(
      [
        lot({
          consumptions: [{ quantity: 40, createdAt: T1 }],
          restorations: [{ quantity: 15, createdAt: T1 }],
        }),
      ],
      T1,
    );
    // consumedBy = 40 − 15 = 25 → remaining 75 × 10
    expect(v.value).toBe(750);
    expect(v.units).toBe(75);
  });

  it('ignores future restorations at an earlier t', () => {
    const v = reconstructValueAt(
      [
        lot({
          consumptions: [{ quantity: 40, createdAt: T0 }],
          restorations: [{ quantity: 40, createdAt: T2 }],
        }),
      ],
      T1,
    );
    expect(v.value).toBe(600);
    expect(v.units).toBe(60);
  });

  it('clamps over-consumed lots at zero (never negative value)', () => {
    const v = reconstructValueAt(
      [lot({ quantity: 10, consumptions: [{ quantity: 25, createdAt: T0 }] })],
      T1,
    );
    expect(v.value).toBe(0);
    expect(v.units).toBe(0);
  });

  it('sums across lots with distinct unit costs', () => {
    const v = reconstructValueAt(
      [
        lot({ quantity: 10, unitCost: 5, receivedAt: T0 }),
        lot({ quantity: 20, unitCost: 7, receivedAt: T1 }),
      ],
      T2,
    );
    expect(v.value).toBe(50 + 140);
    expect(v.units).toBe(30);
    expect(v.lots).toBe(2);
  });
});

// ─── closing_only disclosure ─────────────────────────────────────────────────

describe('reconcileInventoryBasis', () => {
  it('reconstructed when the delegated closing agrees within tolerance', () => {
    expect(reconcileInventoryBasis(1000, 1000.005).basis).toBe('reconstructed');
    expect(reconcileInventoryBasis(1000, 1000.005).reason).toBeUndefined();
  });

  it('closing_only with a reason when history diverges from the delegated close', () => {
    const out = reconcileInventoryBasis(800, 1000);
    expect(out.basis).toBe('closing_only');
    expect(out.reason).toContain('incomplete');
  });
});

// ─── turnover / DOI / sell-through / stock-out ───────────────────────────────

describe('average / turnover / DOI', () => {
  it('average = (open + close) / 2', () => {
    expect(computeAverageInventory(800, 1000)).toBe(900);
  });

  it('turnover = COGS(period) / average', () => {
    expect(computeTurnover(1800, 900)).toBe(2);
  });

  it('turnover is null when average is zero (never 0 or Infinity)', () => {
    expect(computeTurnover(1800, 0)).toBeNull();
  });

  it('DOI = periodDays / turnover; null without turnover', () => {
    expect(computeInventoryDOI(2, 30)).toBe(15);
    expect(computeInventoryDOI(null, 30)).toBeNull();
    expect(computeInventoryDOI(0, 30)).toBeNull();
  });
});

describe('computeSellThrough', () => {
  it('unitsSold / (unitsSold + closingUnits)', () => {
    expect(computeSellThrough(30, 70)).toBeCloseTo(0.3);
  });

  it('null when there is nothing to sell through (never 0%)', () => {
    expect(computeSellThrough(0, 0)).toBeNull();
  });
});

describe('computeStockoutDays', () => {
  it('counts days with stock <= 0 (zero and negative both count)', () => {
    expect(computeStockoutDays([5, 0, -2, 3, 0])).toBe(3);
  });

  it('zero days when stock stays positive', () => {
    expect(computeStockoutDays([1, 2, 3])).toBe(0);
  });
});

describe('computeAging', () => {
  it('buckets reconstructed remaining value by lot age at t', () => {
    const buckets = computeAging(
      [
        lot({ quantity: 10, unitCost: 10, receivedAt: T0 }), // 19d → 0–30
        lot({ quantity: 10, unitCost: 10, receivedAt: new Date('2026-06-01T00:00:00Z') }), // 80d → 61–90
      ],
      T2,
    );
    expect(buckets.map((b) => b.label)).toEqual(['0–30', '31–60', '61–90', '90+']);
    expect(buckets[0].value).toBe(100);
    expect(buckets[0].units).toBe(10);
    expect(buckets[2].value).toBe(100);
    expect(buckets.reduce((s, b) => s + b.value, 0)).toBe(200);
  });

  it('ages only the reconstructed remainder, not the received quantity', () => {
    const buckets = computeAging(
      [lot({ quantity: 100, unitCost: 2, receivedAt: T0, consumptions: [{ quantity: 90, createdAt: T1 }] })],
      T2,
    );
    expect(buckets[0].units).toBe(10);
    expect(buckets[0].value).toBe(20);
  });
});

// ─── movement classes (P1, never reimplemented) ──────────────────────────────

describe('movement classes', () => {
  it('Dead = 0 sold with stock on hand (P1 contract)', () => {
    expect(classifyMovement({ unitsSold: 0, closingStock: 5, periodDays: 30 })).toBe('Dead');
  });

  it('Fast / Slow / Normal follow the 30/90-day policy', () => {
    // DOI = closing × period / sold
    expect(classifyMovement({ unitsSold: 30, closingStock: 30, periodDays: 30 })).toBe('Fast');
    expect(classifyMovement({ unitsSold: 1, closingStock: 100, periodDays: 30 })).toBe('Slow');
    expect(classifyMovement({ unitsSold: 30, closingStock: 60, periodDays: 30 })).toBe('Normal');
  });

  it('policy label names the default 30/90-day policy', () => {
    expect(MOVEMENT_POLICY_LABEL).toBe('classified by our default 30/90-day policy');
    expect(movementPolicyLabel('Fast')).toContain(MOVEMENT_POLICY_LABEL);
  });
});

// ─── lost sales honesty ──────────────────────────────────────────────────────

describe('computeLostSales', () => {
  it('unavailable when no stock-out days occurred', () => {
    const out = computeLostSales({ stockoutDays: 0, unitsSold: 50, periodDays: 30, avgUnitCost: 10 });
    expect(out.state).toBe('unavailable');
    expect(out.lostValue).toBeNull();
    expect(out.reason).toContain('no stock-out');
  });

  it('unavailable when demand is not measurable (no recognised sales)', () => {
    const out = computeLostSales({ stockoutDays: 4, unitsSold: 0, periodDays: 30, avgUnitCost: 10 });
    expect(out.state).toBe('unavailable');
    expect(out.lostValue).toBeNull();
    expect(out.reason).toContain('demand');
  });

  it('estimated from daily sales rate × stock-out days × unit cost', () => {
    // 60 units / 30 days = 2/day × 5 days × 10 = 100
    const out = computeLostSales({ stockoutDays: 5, unitsSold: 60, periodDays: 30, avgUnitCost: 10 });
    expect(out.state).toBe('estimated');
    expect(out.lostUnits).toBe(10);
    expect(out.lostValue).toBe(100);
  });
});

// ─── disclosures ─────────────────────────────────────────────────────────────

describe('disclosure strings', () => {
  it('states the reconstruction formula, the closing-only fallback, and lost-sales honesty', () => {
    expect(INVENTORY_VALUE_BASIS_STATEMENT).toContain('CostingLot');
    expect(INVENTORY_CLOSING_ONLY_NOTE).toContain('closing-only');
    expect(LOST_SALES_NOTE).toContain('stock');
  });
});

// ─── delegation (no forked valuation) ────────────────────────────────────────

describe('AnalyticsInventoryService delegation', () => {
  function serviceWith(delegatedTotal: number) {
    const prisma: any = {
      costingLot: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      physicalInventoryLedger: { findMany: jest.fn().mockResolvedValue([]) },
      managedStockLedger: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const filterService = new AnalyticsFilterService(prisma);
    const cache: any = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
    const inventory: any = { valuation: jest.fn().mockResolvedValue({ totalValue: delegatedTotal, items: [] }) };
    const service = new AnalyticsInventoryService(prisma, filterService, cache, inventory);
    return { service, prisma, inventory };
  }

  const QUERY: any = { preset: 'last_30_days' };

  it('calls InventoryService.valuation for the closing value (never recomputed)', async () => {
    const { service, inventory } = serviceWith(1234);
    const res = await service.getValue(QUERY);
    expect(inventory.valuation).toHaveBeenCalled();
    expect(res.data.value.closing.value).toBe(1234);
  });

  it('closing_only when reconstruction diverges from the delegated close', async () => {
    const prisma: any = {
      costingLot: {
        findMany: jest.fn().mockResolvedValue([
          {
            quantity: 10,
            unitCost: 5,
            receivedAt: new Date('2026-01-01T00:00:00Z'),
            productId: 'p1',
            variantId: null,
            warehouseId: 'w1',
            product: { isActive: true },
            consumptions: [],
          },
        ]),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      physicalInventoryLedger: { findMany: jest.fn().mockResolvedValue([]) },
      managedStockLedger: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const filterService = new AnalyticsFilterService(prisma);
    const cache: any = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
    const inventory: any = { valuation: jest.fn().mockResolvedValue({ totalValue: 9999, items: [] }) };
    const service = new AnalyticsInventoryService(prisma, filterService, cache, inventory);
    const res = await service.getValue(QUERY);
    expect(res.data.basis).toBe('closing_only');
    expect(res.data.value.closing.value).toBe(9999);
    expect(res.data.value.opening.state).toBe('unavailable');
    expect(res.data.turnover.state).toBe('unavailable');
  });

  it('returns periodDays on every payload (value, movement, stockouts, ledger)', async () => {
    const { service } = serviceWith(0);
    const [value, movement, stockouts, ledger] = await Promise.all([
      service.getValue(QUERY),
      service.getMovement(QUERY),
      service.getStockouts(QUERY),
      service.getLedger(QUERY),
    ]);
    for (const res of [value, movement, stockouts, ledger]) {
      expect(res.data.periodDays).toBe(res.meta.range.periodDays);
      expect(res.data.periodDays).toBeGreaterThan(0);
    }
  });
});
