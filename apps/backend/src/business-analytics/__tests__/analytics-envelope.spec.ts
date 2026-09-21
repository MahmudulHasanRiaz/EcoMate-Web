/**
 * P2 data-layer tests — analytics response envelope (§6).
 *
 * Every response carries meta + KpiValue envelopes. null never renders as 0;
 * not_applicable renders "—" and stays visually distinct from unavailable.
 */
import {
  FORMULA_VERSION,
  kpiOk,
  kpiZero,
  kpiNoData,
  kpiNotApplicable,
  kpiUnavailable,
  kpiEstimated,
  buildMeta,
  analyticsCacheKey,
  analyticsCacheTtlMs,
  LIVE_TTL_MS,
  CLOSED_TTL_MS,
  type KpiValue,
} from '../analytics-envelope.util';

describe('KpiValue envelope', () => {
  it('ok carries a numeric value with basis and date basis', () => {
    const kpi: KpiValue<number> = kpiOk(1250.5, {
      basis: 'direct',
      dateBasis: 'Delivered transition',
    });
    expect(kpi).toMatchObject({
      value: 1250.5,
      state: 'ok',
      basis: 'direct',
      dateBasis: 'Delivered transition',
    });
  });

  it('zero is distinct from no_data (null never renders as ৳0)', () => {
    expect(kpiZero('measured — no refunds in range')).toMatchObject({
      value: 0,
      state: 'zero',
    });
    const empty = kpiNoData('no recognised orders in range');
    expect(empty.value).toBeNull();
    expect(empty.state).toBe('no_data');
    expect(empty.value).not.toBe(0);
  });

  it('not_applicable is distinct from unavailable', () => {
    const na = kpiNotApplicable('no data source exists');
    const un = kpiUnavailable('spendDate missing on 2 rows');
    expect(na.state).toBe('not_applicable');
    expect(un.state).toBe('unavailable');
    expect(na.value).toBeNull();
    expect(un.value).toBeNull();
    expect(na.state).not.toBe(un.state);
  });

  it('estimated carries a labelled reference excluded from totals', () => {
    const kpi = kpiEstimated(900, 'courier_default costs', {
      label: 'reference only',
      excludedFromTotal: true,
    });
    expect(kpi.state).toBe('estimated');
    expect(kpi.estimatedReference).toMatchObject({ excludedFromTotal: true });
  });
});

describe('buildMeta', () => {
  const ctx: any = {
    range: {
      start: new Date('2026-09-01T00:00:00+06:00'),
      end: new Date('2026-09-07T17:59:59.999Z'),
      periodDays: 7,
      granularity: 'day',
      comparison: {
        prevStart: new Date('2026-08-25T00:00:00+06:00'),
        prevEnd: new Date('2026-08-31T17:59:59.999Z'),
      },
    },
  };

  it('carries every §6 meta field with the formula version', () => {
    const meta = buildMeta(ctx, { preset: 'last_7_days' } as any, {
      recognition: 'delivered-only',
      costCoverage: { cogs: {} } as any,
      ladderState: 'actual',
      thresholds: { vipMin: 5 },
      dateBasis: 'revenue-date',
    });
    expect(meta.formulaVersion).toBe(FORMULA_VERSION);
    expect(meta).toMatchObject({
      recognition: 'delivered-only',
      ladderState: 'actual',
    });
    for (const key of [
      'range',
      'comparison',
      'filters',
      'granularity',
      'generatedAt',
      'dataAsOf',
      'formulaVersion',
      'recognition',
      'costCoverage',
      'ladderState',
      'thresholds',
      'dateBasis',
    ]) {
      expect(meta).toHaveProperty(key);
    }
  });
});

describe('analytics cache key + TTL', () => {
  it('keys on the filter signature (different filters → different keys)', () => {
    const a = analyticsCacheKey('pnl', { preset: 'last_7_days' } as any);
    const b = analyticsCacheKey(
      'pnl',
      { preset: 'last_7_days', source: 'POS' } as any,
    );
    const c = analyticsCacheKey('fulfillment', {
      preset: 'last_7_days',
    } as any);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a.startsWith('analytics:')).toBe(true);
  });

  it('uses 60s for live ranges and 15min for closed ranges', () => {
    const live = analyticsCacheTtlMs({
      end: new Date(Date.now() + 60_000),
    } as any);
    const closed = analyticsCacheTtlMs({ end: new Date('2020-01-01') } as any);
    expect(live).toBe(LIVE_TTL_MS);
    expect(closed).toBe(CLOSED_TTL_MS);
    expect(LIVE_TTL_MS).toBe(60_000);
    expect(CLOSED_TTL_MS).toBe(15 * 60_000);
  });
});
