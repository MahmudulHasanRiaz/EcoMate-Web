/**
 * P1 pure-rule tests — analytics range utility (§2 time basis, §7.1 time cases).
 *
 * Covers: Dhaka day boundaries (23:30 in / next-day 00:30 out), presets +
 * custom, comparison windows (prevEnd = start−1ms, prevStart = prevEnd −
 * length), granularity, periodDays inclusive (always returned).
 */
import {
  resolveAnalyticsRange,
  autoGranularity,
  containsInstant,
  GRANULARITY_HOUR_MAX,
  GRANULARITY_DAY_MAX,
  GRANULARITY_WEEK_MAX,
  type AnalyticsRange,
} from '../analytics-range.util';

const D = (iso: string): Date => new Date(iso);

describe('Dhaka day boundaries (via dhaka-time, never hand-rolled)', () => {
  let day: AnalyticsRange;
  beforeAll(() => {
    day = resolveAnalyticsRange({
      preset: 'custom',
      startDate: '2026-09-20',
      endDate: '2026-09-20',
    });
  });

  it('single Dhaka day maps to 18:00Z(prev) … 17:59:59.999Z', () => {
    expect(day.start.toISOString()).toBe('2026-09-19T18:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-09-20T17:59:59.999Z');
  });

  it('23:30 Dhaka (17:30Z) belongs to the day', () => {
    expect(containsInstant(day, D('2026-09-20T17:30:00.000Z'))).toBe(true);
  });

  it('next-day 00:30 Dhaka (18:30Z) is outside the day', () => {
    expect(containsInstant(day, D('2026-09-20T18:30:00.000Z'))).toBe(false);
  });

  it('range containment is inclusive on both ends', () => {
    expect(containsInstant(day, day.start)).toBe(true);
    expect(containsInstant(day, day.end)).toBe(true);
    expect(containsInstant(day, new Date(day.start.getTime() - 1))).toBe(false);
    expect(containsInstant(day, new Date(day.end.getTime() + 1))).toBe(false);
  });
});

describe('presets + custom', () => {
  const now = D('2026-09-21T10:00:00.000Z'); // 16:00 Dhaka, 21 Sep

  it('today covers the current Dhaka day', () => {
    const r = resolveAnalyticsRange({ preset: 'today', now });
    expect(r.start.toISOString()).toBe('2026-09-20T18:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-21T17:59:59.999Z');
    expect(r.periodDays).toBe(1);
  });

  it('yesterday covers the previous Dhaka day', () => {
    const r = resolveAnalyticsRange({ preset: 'yesterday', now });
    expect(r.start.toISOString()).toBe('2026-09-19T18:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-20T17:59:59.999Z');
    expect(r.periodDays).toBe(1);
  });

  it('last_7_days spans 7 inclusive Dhaka days', () => {
    const r = resolveAnalyticsRange({ preset: 'last_7_days', now });
    expect(r.periodDays).toBe(7);
    expect(r.end.toISOString()).toBe('2026-09-21T17:59:59.999Z');
  });

  it('last_30_days spans 30 inclusive Dhaka days', () => {
    const r = resolveAnalyticsRange({ preset: 'last_30_days', now });
    expect(r.periodDays).toBe(30);
  });

  it('this_month starts on the 1st of the Dhaka month', () => {
    const r = resolveAnalyticsRange({ preset: 'this_month', now });
    expect(r.start.toISOString()).toBe('2026-08-31T18:00:00.000Z');
    expect(r.periodDays).toBe(21);
  });

  it('this_quarter and this_year anchor correctly', () => {
    const q = resolveAnalyticsRange({ preset: 'this_quarter', now });
    expect(q.start.toISOString()).toBe('2026-06-30T18:00:00.000Z'); // 1 Jul Dhaka
    const y = resolveAnalyticsRange({ preset: 'this_year', now });
    expect(y.start.toISOString()).toBe('2025-12-31T18:00:00.000Z'); // 1 Jan Dhaka
    expect(y.periodDays).toBe(264);
  });

  it('custom 3-day range has periodDays 3', () => {
    const r = resolveAnalyticsRange({
      preset: 'custom',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    });
    expect(r.periodDays).toBe(3);
    expect(r.start.toISOString()).toBe('2026-08-31T18:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-03T17:59:59.999Z');
  });

  it('custom without both dates throws with the received inputs echoed', () => {
    expect(() =>
      resolveAnalyticsRange({ preset: 'custom', startDate: '2026-09-01' }),
    ).toThrow(/startDate.*endDate/);
  });

  it('custom with unresolvable dates throws with the inputs echoed', () => {
    expect(() =>
      resolveAnalyticsRange({
        preset: 'custom',
        startDate: 'not-a-date',
        endDate: '2026-09-03',
      }),
    ).toThrow(/unresolvable custom range dates: startDate=not-a-date/);
  });

  it('custom with end before start throws', () => {
    expect(() =>
      resolveAnalyticsRange({
        preset: 'custom',
        startDate: '2026-09-03',
        endDate: '2026-09-01',
      }),
    ).toThrow(/precedes/);
  });
});

describe('comparison windows', () => {
  it('prevEnd = start − 1ms and prevStart = prevEnd − length (absolute)', () => {
    const r = resolveAnalyticsRange({
      preset: 'custom',
      startDate: '2026-09-01',
      endDate: '2026-09-03',
    });
    expect(r.start.toISOString()).toBe('2026-08-31T18:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-03T17:59:59.999Z');
    expect(r.comparison.prevEnd.toISOString()).toBe(
      '2026-08-31T17:59:59.999Z',
    );
    expect(r.comparison.prevStart.toISOString()).toBe(
      '2026-08-28T18:00:00.000Z',
    );
  });

  it('comparison window is the identical length with no overlap or gap', () => {
    const r = resolveAnalyticsRange({ preset: 'last_7_days', now: D('2026-09-21T10:00:00Z') });
    const length = r.end.getTime() - r.start.getTime();
    const prevLength =
      r.comparison.prevEnd.getTime() - r.comparison.prevStart.getTime();
    expect(prevLength).toBe(length);
    expect(r.comparison.prevEnd.getTime()).toBeLessThan(r.start.getTime());
  });
});

describe('granularity + periodDays', () => {
  it('auto-granularity follows the default policy', () => {
    expect(GRANULARITY_HOUR_MAX).toBe(2);
    expect(GRANULARITY_DAY_MAX).toBe(62);
    expect(GRANULARITY_WEEK_MAX).toBe(185);
    expect(autoGranularity(1)).toBe('hour');
    expect(autoGranularity(GRANULARITY_HOUR_MAX)).toBe('hour');
    expect(autoGranularity(GRANULARITY_HOUR_MAX + 1)).toBe('day');
    expect(autoGranularity(GRANULARITY_DAY_MAX)).toBe('day');
    expect(autoGranularity(GRANULARITY_DAY_MAX + 1)).toBe('week');
    expect(autoGranularity(GRANULARITY_WEEK_MAX)).toBe('week');
    expect(autoGranularity(GRANULARITY_WEEK_MAX + 1)).toBe('month');
  });

  it('resolved ranges always carry periodDays and granularity', () => {
    const one = resolveAnalyticsRange({ preset: 'today', now: D('2026-09-21T10:00:00Z') });
    expect(one.periodDays).toBe(1);
    expect(one.granularity).toBe('hour');
    const thirty = resolveAnalyticsRange({ preset: 'last_30_days', now: D('2026-09-21T10:00:00Z') });
    expect(thirty.periodDays).toBe(30);
    expect(thirty.granularity).toBe('day');
  });
});
