/**
 * P2 data-layer tests — fulfillment economics (§2.10, D8/D11, §7.1).
 *
 * COD collection is never inferred from Order.total or any order field
 * (behavioural guard); courierCost stays present for COD; R11 leak guard.
 */
import { PaymentStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import {
  computeFulfillment,
  assertNoRevenueLeak,
  AnalyticsFulfillmentService,
  type FulfillmentOrderInput,
} from '../analytics-fulfillment.service';
import { AnalyticsFilterService } from '../analytics-filter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import {
  UnavailableSettlementSource,
  collectionKindOf,
} from '../settlement-source';

const D = (s: string) => new Date(s);

function online(
  extra: Partial<FulfillmentOrderInput> = {},
): FulfillmentOrderInput {
  return {
    id: 'on1',
    paymentOptionType: 'FULL_PAYMENT',
    shippingCharge: 80,
    shippingCost: 60,
    shippingCostSource: 'manual',
    payments: [
      {
        amount: 1000,
        status: PaymentStatus.PAID,
        gatewayCode: 'bkash',
        createdAt: D('2026-09-11T10:00:00+06:00'),
      },
    ],
    refunds: [],
    ...extra,
  };
}

function cod(
  extra: Partial<FulfillmentOrderInput> = {},
): FulfillmentOrderInput {
  return {
    id: 'cod1',
    paymentOptionType: 'CASH_ON_DELIVERY',
    shippingCharge: 80,
    shippingCost: 60,
    shippingCostSource: 'manual',
    payments: [],
    refunds: [],
    ...extra,
  };
}

describe('collectionKindOf', () => {
  it('classifies COD / online / unknown without reading totals', () => {
    expect(collectionKindOf('CASH_ON_DELIVERY')).toBe('cod');
    expect(collectionKindOf('FULL_PAYMENT')).toBe('online');
    expect(collectionKindOf('PARTIAL_PAYMENT')).toBe('online');
    expect(collectionKindOf(null)).toBe('unknown');
    expect(collectionKindOf(undefined)).toBe('unknown');
  });
});

describe('UnavailableSettlementSource (D11 seam)', () => {
  it('returns unavailable with the canonical reason for every COD field', () => {
    const source = new UnavailableSettlementSource();
    expect(source.getCodCollection({ id: 'cod1' })).toEqual({
      state: 'unavailable',
      reason: 'no_courier_settlement_source',
      amountCollected: null,
      amountRetained: null,
      deliveryChargeRetained: null,
      fulfillmentMargin: null,
    });
  });
});

describe('computeFulfillment — online orders', () => {
  it('collects PAID payments actually and retains with no refund', () => {
    const r = computeFulfillment([online()]);
    const row = r.rows[0];
    expect(row.amountCollected).toMatchObject({ value: 1000, state: 'actual' });
    expect(row.amountRetained).toMatchObject({ value: 1000, state: 'actual' });
    expect(row.deliveryChargeRetained).toMatchObject({
      value: 80,
      state: 'actual',
      inference: 'none',
    });
    expect(row.fulfillmentMargin).toMatchObject({ value: 20, state: 'actual' });
  });

  it('zeroes retained delivery charge on full shipping refunds (covered)', () => {
    const r = computeFulfillment([
      online({
        refunds: [
          {
            amount: 1000,
            status: 'completed',
            createdAt: D('2026-09-12T10:00:00+06:00'),
          },
        ],
      }),
    ]);
    const row = r.rows[0];
    expect(row.amountRefunded).toMatchObject({ value: 1000, state: 'actual' });
    expect(row.amountRetained).toMatchObject({ value: 0, state: 'actual' });
    expect(row.deliveryChargeRetained).toMatchObject({
      value: 0,
      inference: 'covered',
    });
    expect(row.fulfillmentMargin).toMatchObject({ value: -60, state: 'actual' });
  });

  it('keeps the full charge on below-shipping refunds with disclosure', () => {
    const r = computeFulfillment([
      online({
        refunds: [
          {
            amount: 30,
            status: 'completed',
            createdAt: D('2026-09-12T10:00:00+06:00'),
          },
        ],
      }),
    ]);
    expect(r.rows[0].deliveryChargeRetained).toMatchObject({
      value: 80,
      inference: 'below',
    });
  });

  it('treats free delivery as pure cost', () => {
    const r = computeFulfillment([online({ shippingCharge: 0 })]);
    expect(r.rows[0].deliveryChargeRetained).toMatchObject({ value: 0 });
    expect(r.rows[0].fulfillmentMargin).toMatchObject({ value: -60 });
  });

  it('reports profitable delivery when retained exceeds cost', () => {
    const r = computeFulfillment([
      online({ shippingCharge: 120, shippingCost: 60 }),
    ]);
    expect(r.rows[0].fulfillmentMargin).toMatchObject({ value: 60 });
    expect(r.totals.fulfillmentMargin).toBe(60);
  });
});

describe('computeFulfillment — COD honesty (D11)', () => {
  it('marks all COD collection fields unavailable with courierCost present', () => {
    const r = computeFulfillment([cod()]);
    const row = r.rows[0];
    expect(row.amountCollected).toMatchObject({
      value: null,
      state: 'unavailable',
      reason: 'no_courier_settlement_source',
    });
    expect(row.amountRetained.value).toBeNull();
    expect(row.deliveryChargeRetained.value).toBeNull();
    expect(row.fulfillmentMargin.value).toBeNull();
    expect(row.courierCost).toMatchObject({ value: 60, state: 'actual' });
  });

  it('never derives COD collection from Order.total or paymentStatus', () => {
    const r = computeFulfillment([
      {
        ...cod(),
        total: 999999,
        paymentStatus: 'PAID',
        payments: [
          {
            amount: 999999,
            status: PaymentStatus.PAID,
            gatewayCode: 'cash',
            createdAt: D('2026-09-11T10:00:00+06:00'),
          },
        ],
      } as any,
    ]);
    expect(r.rows[0].amountCollected.value).toBeNull();
    expect(r.rows[0].amountRetained.value).toBeNull();
  });

  it('attempts no shipping-refund inference for COD', () => {
    const r = computeFulfillment([
      cod({
        refunds: [
          {
            amount: 1000,
            status: 'completed',
            createdAt: D('2026-09-12T10:00:00+06:00'),
          },
        ],
      }),
    ]);
    expect(r.rows[0].deliveryChargeRetained).toMatchObject({
      value: null,
      state: 'unavailable',
      inference: 'none',
    });
    // Refund rows are real data and stay visible even for COD.
    expect(r.rows[0].amountRefunded).toMatchObject({
      value: 1000,
      state: 'actual',
    });
  });

  it('treats unknown collection as unavailable (never guessed online)', () => {
    const r = computeFulfillment([
      online({ id: 'u1', paymentOptionType: null }),
    ]);
    expect(r.rows[0].amountCollected.state).toBe('unavailable');
    expect(r.coverage.collectionUnavailableOrders).toBe(1);
    expect(r.coverage.unknownAmount).toBe(60);
  });

  it('emits the COD gap banner payload with courier cost', () => {
    const r = computeFulfillment([online(), cod(), cod({ id: 'cod2' })]);
    expect(r.coverage).toMatchObject({
      onlineOrders: 1,
      codOrders: 2,
      collectionUnavailableOrders: 2,
    });
    expect(r.gapBanner.codOrders).toBe(2);
    expect(r.gapBanner.courierCost).toBe(120);
    expect(r.gapBanner.message).toContain('settlement');
  });
});

describe('R11 leak guard', () => {
  it('fails when a settlement row carries revenue keys', () => {
    expect(() =>
      assertNoRevenueLeak([{ grossSales: 1 }] as any),
    ).toThrow(/revenue/i);
    expect(() => assertNoRevenueLeak([{ netSales: 1 }] as any)).toThrow(
      /revenue/i,
    );
  });

  it('passes clean settlement rows and labels the panel outside revenue', () => {
    const r = computeFulfillment([online(), cod()]);
    expect(() => assertNoRevenueLeak(r.rows)).not.toThrow();
    expect(r.panelNote).toContain('Not part of recognised revenue');
    expect(r.rows[0]).not.toHaveProperty('grossSales');
  });
});

describe('AnalyticsFulfillmentService.getFulfillment range scoping', () => {
  const sepRange = {
    start: new Date('2026-09-01T00:00:00+06:00'),
    end: new Date('2026-09-30T17:59:59.999Z'),
    periodDays: 30,
    granularity: 'day',
    comparison: { prevStart: new Date(), prevEnd: new Date() },
  };
  const augRange = {
    ...sepRange,
    start: new Date('2026-08-01T00:00:00+06:00'),
    end: new Date('2026-08-31T17:59:59.999Z'),
  };

  function row(
    id: string,
    timeline: { status: string; timestamp: string }[],
    status = 'Delivered',
  ) {
    return {
      id,
      paymentOptionType: 'FULL_PAYMENT',
      shippingCharge: 80,
      shippingCost: 60,
      shippingCostSource: 'manual',
      status: { name: status },
      timeline,
      payments: [],
      refunds: [],
      dispatches: [],
    };
  }

  const rows = () => [
    row('sep-order', [{ status: 'Delivered', timestamp: '2026-09-10T10:00:00+06:00' }]),
    row('aug-order', [{ status: 'Delivered', timestamp: '2026-08-10T10:00:00+06:00' }]),
    row(
      'unrecognised',
      [{ status: 'Confirmed', timestamp: '2026-09-10T10:00:00+06:00' }],
      'Confirmed',
    ),
  ];

  async function serviceFor(range: typeof sepRange) {
    const mockPrisma: any = {
      order: { findMany: jest.fn().mockResolvedValue(rows()) },
    };
    const mockFilter: any = {
      resolveContext: jest.fn().mockReturnValue({ range, filters: {} }),
      buildOrderWhere: jest.fn().mockReturnValue({ trashedAt: null }),
      resolveMarketingOrderIds: jest.fn(),
    };
    const cache: any = { get: jest.fn().mockResolvedValue(undefined), set: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsFulfillmentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsFilterService, useValue: mockFilter },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();
    return module.get(AnalyticsFulfillmentService);
  }

  it('scopes rows to the recognised-in-range cohort', async () => {
    const svc = await serviceFor(sepRange as any);
    const res = await svc.getFulfillment({} as any);
    expect(res.data.rows.map((r: any) => r.orderId)).toEqual(['sep-order']);
  });

  it('serves different payloads for different ranges (no cross-range cache bleed)', async () => {
    const sep = await (await serviceFor(sepRange as any)).getFulfillment({} as any);
    const aug = await (await serviceFor(augRange as any)).getFulfillment({} as any);
    expect(sep.data.rows.map((r: any) => r.orderId)).toEqual(['sep-order']);
    expect(aug.data.rows.map((r: any) => r.orderId)).toEqual(['aug-order']);
  });
});
