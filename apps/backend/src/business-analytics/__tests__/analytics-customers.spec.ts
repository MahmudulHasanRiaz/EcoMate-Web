/**
 * P6 customer analytics tests (§2.7, §7.1 aggregation/dimensions guest/phone-less).
 *
 * Pure computeCustomerMetrics()/computeCohorts() over fixtures (recognition
 * via metric-contract, never duplicated) + service fetch wiring (trashed
 * excluded) + the no-predictive-vocabulary guard: the forbidden token appears
 * nowhere outside comments that forbid it.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  computeCustomerMetrics,
  computeCohorts,
  orderCustomerRevenue,
  monthKey,
  windowMonths,
  segmentOfLifetime,
  COHORT_INSUFFICIENT_HISTORY,
  type CustomerOrderInput,
  type CustomerRange,
} from '../analytics-customers.service';
import { AnalyticsCustomersService } from '../analytics-customers.service';
import { AnalyticsFilterService } from '../analytics-filter.service';

const D = (s: string) => new Date(s);
// September window; August history visible for the new/returning boundary.
const RANGE: CustomerRange = {
  start: D('2026-09-01T00:00:00+06:00'),
  end: D('2026-09-30T23:59:59.999+06:00'),
};

let seq = 0;
function order(extra: Partial<CustomerOrderInput> = {}): CustomerOrderInput {
  seq += 1;
  return {
    id: `o${seq}`,
    displayId: `ORD-${seq}`,
    subtotal: 1000,
    discount: 0,
    discountType: 'flat',
    status: 'Delivered',
    timeline: [{ status: 'Delivered', timestamp: D('2026-09-10T10:00:00+06:00') }],
    dispatchDeliveredAt: null,
    customerId: null,
    customerPhone: null,
    guestPhone: null,
    items: [{ price: 500, quantity: 2 }],
    ...extra,
  };
}

function delivered(ts: string): CustomerOrderInput['timeline'] {
  return [{ status: 'Delivered', timestamp: D(ts) }];
}

// ─── new vs returning boundary ─────────────────────────────────────────────

describe('new vs returning boundary (first-ever recognised)', () => {
  it('counts a first-ever September recognition as New', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [order({ id: 'n1', customerId: 'C-NEW' })],
    });
    expect(r.customersInRange).toBe(1);
    expect(r.newCustomers).toBe(1);
    expect(r.returningCustomers).toBe(0);
  });

  it('counts a customer recognised in August as Returning in September', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [
        order({
          id: 'old',
          customerId: 'C-OLD',
          timeline: delivered('2026-08-15T10:00:00+06:00'),
          status: 'Delivered',
        }),
        order({ id: 'sep', customerId: 'C-OLD' }),
      ],
    });
    expect(r.customersInRange).toBe(1);
    expect(r.newCustomers).toBe(0);
    expect(r.returningCustomers).toBe(1);
  });

  it('ignores pre-delivery orders for the boundary (never recognised)', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [
        order({ id: 'p', customerId: 'C-P', status: 'Confirmed', timeline: [] }),
      ],
    });
    expect(r.customersInRange).toBe(0);
    expect(r.newCustomers).toBe(0);
    expect(r.returningCustomers).toBe(0);
    expect(r.repeatRate).toBeNull();
  });
});

// ─── repeat rate math ──────────────────────────────────────────────────────

describe('repeat purchase rate (≥2 lifetime ÷ ≥1)', () => {
  it('computes 1/2 for one repeater and one single-timer', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [
        order({ id: 'a1', customerId: 'A' }),
        order({ id: 'a2', customerId: 'A', timeline: delivered('2026-09-12T10:00:00+06:00') }),
        order({ id: 'b1', customerId: 'B' }),
      ],
    });
    expect(r.repeatRate).toBe(0.5);
  });

  it('counts pre-range lifetime orders toward the ≥2 numerator', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [
        order({ id: 'a0', customerId: 'A', timeline: delivered('2026-08-05T10:00:00+06:00'), status: 'Delivered' }),
        order({ id: 'a1', customerId: 'A' }),
      ],
    });
    expect(r.repeatRate).toBe(1);
    expect(r.returningCustomers).toBe(1);
  });
});

// ─── guest phone normalization ─────────────────────────────────────────────

describe('guest identity via normalized phone', () => {
  it('merges two formats of the same number into one customer', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [
        order({ id: 'g1', guestPhone: '01712345678' }),
        order({
          id: 'g2',
          guestPhone: '+8801712345678',
          timeline: delivered('2026-09-14T10:00:00+06:00'),
        }),
      ],
    });
    expect(r.customersInRange).toBe(1);
    expect(r.repeatRate).toBe(1);
    expect(r.unattributed.orders).toBe(0);
  });

  it('sends phone-less guests to unattributed, never merged', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [
        order({ id: 'u1' }),
        order({ id: 'u2', timeline: delivered('2026-09-14T10:00:00+06:00') }),
        order({ id: 'k1', customerId: 'K' }),
      ],
    });
    expect(r.customersInRange).toBe(1);
    expect(r.unattributed.orders).toBe(2);
    expect(r.unattributed.customers).toBe(2);
    expect(r.unattributed.revenue).toBe(2000);
    // Attributed math is untouched by the unattributed bucket.
    expect(r.rangeRevenue).toBe(1000);
    expect(r.repeatRate).toBe(0);
  });
});

// ─── CLR cumulative ────────────────────────────────────────────────────────

describe('CLR — observed cumulative revenue', () => {
  it('accumulates lifetime recognised revenue across the boundary', () => {
    const r = computeCustomerMetrics({
      range: RANGE,
      orders: [
        order({ id: 'a0', customerId: 'A', timeline: delivered('2026-08-05T10:00:00+06:00'), status: 'Delivered' }),
        order({ id: 'a1', customerId: 'A' }),
      ],
    });
    expect(r.cumulativeClr).toBe(2000);
    expect(r.rangeRevenue).toBe(1000);
    expect(r.revenuePerCustomer).toBe(1000);
    expect(r.ordersPerCustomer).toBe(1);
    expect(r.averageCustomerOrderValue).toBe(1000);
  });

  it('uses lineNet (discount allocated), never the delivery charge', () => {
    const o = order({
      customerId: 'A',
      subtotal: 1000,
      discount: 100,
      discountType: 'flat',
      items: [{ price: 500, quantity: 2 }],
    });
    expect(orderCustomerRevenue(o)).toBe(900);
  });
});

// ─── cohorts ───────────────────────────────────────────────────────────────

describe('cohorts (acquisition month × retention × cumulative CLR)', () => {
  const WIDE: CustomerRange = {
    start: D('2026-08-01T00:00:00+06:00'),
    end: D('2026-09-30T23:59:59.999+06:00'),
  };

  it('returns insufficient_history for a sub-two-month window', () => {
    const r = computeCohorts({
      range: {
        start: D('2026-09-01T00:00:00+06:00'),
        end: D('2026-09-15T23:59:59.999+06:00'),
      },
      orders: [order({ customerId: 'A' })],
    });
    expect(r.state).toBe(COHORT_INSUFFICIENT_HISTORY);
    if (r.state === COHORT_INSUFFICIENT_HISTORY) {
      expect(r.cohorts).toBeUndefined();
      expect(r.reason).toMatch(/two calendar months/);
    }
  });

  it('emits full cohort rows (never partial) over a two-month window', () => {
    const r = computeCohorts({
      range: WIDE,
      orders: [
        order({ id: 'a0', customerId: 'A', timeline: delivered('2026-08-05T10:00:00+06:00'), status: 'Delivered' }),
        order({ id: 'a1', customerId: 'A' }),
        order({ id: 'b1', customerId: 'B' }),
      ],
    });
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') throw new Error('expected ok cohorts');
    expect(r.months).toEqual(['2026-08', '2026-09']);
    const aug = r.cohorts.find((c) => c.acquisitionMonth === '2026-08');
    const sep = r.cohorts.find((c) => c.acquisitionMonth === '2026-09');
    expect(aug?.size).toBe(1);
    expect(aug?.cumulativeClr).toBe(2000);
    // A re-activated in September: offset-1 retention 1/1.
    expect(aug?.retention).toHaveLength(2);
    expect(aug?.retention[1]).toMatchObject({ month: '2026-09', offset: 1, active: 1, rate: 1 });
    expect(sep?.size).toBe(1);
    expect(sep?.cumulativeClr).toBe(1000);
  });

  it('derives window months across a year boundary', () => {
    expect(
      windowMonths({
        start: D('2025-12-20T00:00:00+06:00'),
        end: D('2026-01-10T23:59:59.999+06:00'),
      }),
    ).toEqual(['2025-12', '2026-01']);
    expect(monthKey(D('2026-09-10T10:00:00+06:00'))).toBe('2026-09');
  });
});

// ─── segments ──────────────────────────────────────────────────────────────

describe('segment labels (new / returning / vip)', () => {
  it('labels five lifetime recognised orders as vip', () => {
    const life = {
      key: 'customer:V',
      firstAt: D('2026-01-05T10:00:00+06:00'),
      lifetime: 5,
      lifetimeRevenue: 5000,
      rangeOrders: 1,
      rangeRevenue: 1000,
      orderIds: ['o1'],
    };
    expect(segmentOfLifetime(life, RANGE)).toBe('vip');
    expect(segmentOfLifetime({ ...life, lifetime: 4 }, RANGE)).toBe('returning');
    expect(
      segmentOfLifetime({ ...life, lifetime: 4, firstAt: D('2026-09-10T10:00:00+06:00') }, RANGE),
    ).toBe('new');
  });
});

// ─── service wiring: trashed excluded ──────────────────────────────────────

describe('AnalyticsCustomersService fetch wiring', () => {
  it('excludes trashed orders via buildOrderWhere', async () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn() },
    };
    const filters = new AnalyticsFilterService(prisma);
    const cache: any = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    const svc = new AnalyticsCustomersService(prisma, filters, cache);
    await svc.getSummary({ preset: 'last_30_days' } as any);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ trashedAt: null }),
      }),
    );
  });
});

// ─── no predictive vocabulary ──────────────────────────────────────────────

describe('no predictive-vocabulary guard', () => {
  // The forbidden token is built, never written literally: this file must
  // itself pass the grep it enforces.
  const token = String.fromCharCode(76, 84, 86);
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/.*$/gm, '$1');

  it.each([
    path.join(__dirname, '..', 'analytics-customers.service.ts'),
    __filename,
  ])('no %s carries the token outside forbidding comments', (file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(stripComments(src)).not.toContain(token);
  });
});
