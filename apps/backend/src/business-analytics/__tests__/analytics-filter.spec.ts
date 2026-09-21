/**
 * P2 data-layer tests — analytics filter (§4.1, §7.1 aggregation/dimensions).
 *
 * Single filter DTO every service consumes. Source System and Sales Channel
 * stay separate; there is no Store dimension. Every filter lands in the
 * backend query — asserted on the Prisma where clause, never on local data.
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PaymentStatus } from '@prisma/client';
import {
  AnalyticsFilterDto,
  ANALYTICS_FILTER_FIELDS,
} from '../analytics-filter.dto';
import {
  AnalyticsFilterService,
  VIP_MIN_LIFETIME_RECOGNISED_ORDERS,
  VIP_POLICY_RATIONALE,
  MARKETING_UNATTRIBUTED,
  resolveMarketingSource,
  deriveCustomerSegments,
} from '../analytics-filter.service';

function dtoOf(query: Record<string, unknown>): AnalyticsFilterDto {
  return plainToInstance(AnalyticsFilterDto, query);
}

describe('AnalyticsFilterDto', () => {
  it('accepts an empty query (all filters optional)', async () => {
    const errors = await validate(dtoOf({}));
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown Store dimension (F7 — no store filter exists)', async () => {
    expect(ANALYTICS_FILTER_FIELDS).not.toContain('store');
    expect(ANALYTICS_FILTER_FIELDS).not.toContain('storeId');
    // Mirrors the global ValidationPipe (whitelist: true): unknown props are
    // stripped, never honoured.
    const dto = dtoOf({ store: 'dhaka' } as any);
    const errors = await validate(dto, { whitelist: true });
    expect(dto).not.toHaveProperty('store');
    expect(errors).toHaveLength(0);
  });

  it('keeps Source System and Sales Channel as separate fields', async () => {
    const dto = dtoOf({ source: 'POS', salesChannel: 'WEBSITE' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.source).toBe('POS');
    expect(dto.salesChannel).toBe('WEBSITE');
  });

  it('rejects invalid source / segment / collection values', async () => {
    const errors = await validate(
      dtoOf({
        source: 'SHOPIFY',
        customerSegment: 'gold',
        collectionStatus: 'maybe',
      }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects malformed custom dates', async () => {
    const errors = await validate(
      dtoOf({ preset: 'custom', startDate: '21-09-2026', endDate: 'tomorrow' }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AnalyticsFilterService.buildOrderWhere', () => {
  const svc = new AnalyticsFilterService({} as any);

  it('always excludes trashed orders, even with no filters', () => {
    expect(svc.buildOrderWhere(dtoOf({}))).toMatchObject({
      trashedAt: null,
    });
  });

  it('pushes Source System and Sales Channel as separate predicates', () => {
    const where = svc.buildOrderWhere(
      dtoOf({ source: 'POS', salesChannel: 'FACEBOOK' }),
    );
    expect(where).toMatchObject({
      trashedAt: null,
      source: 'POS',
      salesChannel: 'FACEBOOK',
    });
  });

  it('matches multi-payment orders on >=1 PAID payment of the method', () => {
    const where = svc.buildOrderWhere(dtoOf({ paymentMethod: 'bkash' }));
    expect(where).toMatchObject({
      payments: { some: { gatewayCode: 'bkash', status: PaymentStatus.PAID } },
    });
  });

  it('expands product/variant combos via OrderItemComboComponent', () => {
    const where = svc.buildOrderWhere(
      dtoOf({ productId: 'p1', variantId: 'v1' }),
    );
    const itemsSome = (where as any).items.some.OR as any[];
    expect(itemsSome).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: 'p1' }),
        expect.objectContaining({
          comboComponents: { some: { productId: 'p1' } },
        }),
        expect.objectContaining({ variantId: 'v1' }),
        expect.objectContaining({
          comboComponents: { some: { variantId: 'v1' } },
        }),
      ]),
    );
  });

  it('matches categories via Product.categoryId and ProductCategory', () => {
    const where = svc.buildOrderWhere(dtoOf({ categoryId: 'c1' }));
    const itemsSome = (where as any).items.some.OR as any[];
    expect(JSON.stringify(itemsSome)).toContain('c1');
    expect(JSON.stringify(itemsSome)).toContain('productCategories');
  });

  it('matches location snapshots (city/state/zip) and warehouse', () => {
    const where = svc.buildOrderWhere(
      dtoOf({ location: 'Dhaka', warehouseId: 'w1' }),
    );
    expect(JSON.stringify(where)).toContain('Dhaka');
    expect(JSON.stringify(where)).toContain('customerCity');
    expect(where).toMatchObject({
      items: expect.objectContaining({
        some: expect.objectContaining({ sourceWarehouseId: 'w1' }),
      }),
    });
  });

  it('maps delivery outcomes to status-name sets (never invents stages)', () => {
    expect(
      (svc.buildOrderWhere(dtoOf({ deliveryOutcome: 'delivered' })) as any)
        .status.name.in,
    ).toEqual(['Delivered']);
    expect(
      (svc.buildOrderWhere(dtoOf({ deliveryOutcome: 'returned' })) as any)
        .status.name.in,
    ).toEqual(expect.arrayContaining(['Returned', 'Damaged']));
    expect(
      (svc.buildOrderWhere(dtoOf({ deliveryOutcome: 'cancelled' })) as any)
        .status.name.in,
    ).toEqual(['Cancelled']);
    const inFulfilment = (
      svc.buildOrderWhere(dtoOf({ deliveryOutcome: 'in_fulfilment' })) as any
    ).status.name.in as string[];
    expect(inFulfilment).toEqual(
      expect.arrayContaining(['Confirmed', 'Shipping']),
    );
    expect(inFulfilment).not.toContain('Delivered');
  });

  it('maps collection status to paymentOptionType (unknown grouped with COD)', () => {
    const cod = svc.buildOrderWhere(
      dtoOf({ collectionStatus: 'cod-unavailable' }),
    ) as any;
    // COD plus NULL (unknown collection) — D11-strict, both unavailable.
    expect(JSON.stringify(cod.OR)).toContain('CASH_ON_DELIVERY');
    const online = svc.buildOrderWhere(
      dtoOf({ collectionStatus: 'online-collected' }),
    ) as any;
    expect(online.paymentOptionType.in).toEqual(
      expect.arrayContaining(['FULL_PAYMENT', 'PARTIAL_PAYMENT']),
    );
    expect(online.paymentOptionType.in).not.toContain('CASH_ON_DELIVERY');
  });

  it('constrains marketing source to resolved order ids (DB-side)', () => {
    const where = svc.buildOrderWhere(dtoOf({}), ['o1', 'o2']);
    expect(where).toMatchObject({ id: { in: ['o1', 'o2'] } });
    expect(svc.buildOrderWhere(dtoOf({}))).not.toHaveProperty('id');
  });
});

describe('resolveMarketingSource', () => {
  it('prefers the platform slug through attribution → campaign → account → platform', () => {
    expect(
      resolveMarketingSource(
        {
          campaign: {
            adAccount: { connection: { platform: { slug: 'meta' } } },
          },
        } as any,
        { utmSource: 'google' } as any,
      ),
    ).toBe('meta');
  });

  it('falls back to utmSource, else unattributed (never Order.sourcePlatform)', () => {
    expect(resolveMarketingSource(null, { utmSource: 'tiktok' } as any)).toBe(
      'tiktok',
    );
    expect(resolveMarketingSource(null, null)).toBe(MARKETING_UNATTRIBUTED);
    expect(resolveMarketingSource(null, {} as any)).toBe(
      MARKETING_UNATTRIBUTED,
    );
  });
});

describe('customer segments (derived new/returning/vip)', () => {
  const range = {
    start: new Date('2026-09-01T00:00:00+06:00'),
    end: new Date('2026-09-30T17:59:59.999Z'),
  };

  it('exposes the VIP default policy (measured, labelled — not a universal truth)', () => {
    expect(VIP_MIN_LIFETIME_RECOGNISED_ORDERS).toBeGreaterThan(1);
    expect(typeof VIP_POLICY_RATIONALE).toBe('string');
    expect(VIP_POLICY_RATIONALE.length).toBeGreaterThan(20);
  });

  it('classifies new vs returning vs vip from recognised history', () => {
    const map = deriveCustomerSegments([
      { key: 'new-1', at: new Date('2026-09-10T00:00:00Z') },
      { key: 'ret-1', at: new Date('2026-08-01T00:00:00Z') },
      { key: 'ret-1', at: new Date('2026-09-10T00:00:00Z') },
      ...Array.from(
        { length: VIP_MIN_LIFETIME_RECOGNISED_ORDERS },
        (_, i) => ({
          key: 'vip-1',
          at: new Date(`2026-0${(i % 8) + 1}-10T00:00:00Z`),
        }),
      ),
    ]);
    const svc = new AnalyticsFilterService({} as any);
    expect(svc.segmentOf('new-1', range as any, map)).toBe('new');
    expect(svc.segmentOf('ret-1', range as any, map)).toBe('returning');
    expect(svc.segmentOf('vip-1', range as any, map)).toBe('vip');
    expect(svc.segmentOf('ghost', range as any, map)).toBe('new');
  });
});

describe('resolveContext', () => {
  const svc = new AnalyticsFilterService({} as any);

  it('resolves Dhaka ranges with comparison and granularity', () => {
    const ctx = svc.resolveContext(
      dtoOf({ preset: 'last_7_days', granularity: 'day' }),
    );
    expect(ctx.range.periodDays).toBe(7);
    expect(ctx.range.granularity).toBe('day');
    expect(ctx.range.comparison.prevEnd.getTime()).toBe(
      ctx.range.start.getTime() - 1,
    );
  });

  it('requires both dates for custom presets', () => {
    expect(() => svc.resolveContext(dtoOf({ preset: 'custom' }))).toThrow();
    expect(() =>
      svc.resolveContext(
        dtoOf({
          preset: 'custom',
          startDate: '2026-09-01',
          endDate: '2026-09-07',
        }),
      ),
    ).not.toThrow();
  });
});
