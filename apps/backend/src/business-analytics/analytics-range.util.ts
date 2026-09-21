/**
 * Analytics range utility (P1).
 *
 * Dhaka calendar-day ranges, inclusive. Comparison = immediately preceding
 * window of identical length (prevEnd = start − 1ms). periodDays is inclusive
 * and always returned. All day math delegates to dhaka-time — never hand-rolled.
 */
import {
  DHAKA_OFFSET_MS,
  startOfDhakaDay,
  endOfDhakaDay,
  dhakaDayRange,
  dhakaDateParts,
} from '../common/utils/dhaka-time';

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'this_quarter'
  | 'this_year'
  | 'custom';

export type Granularity = 'hour' | 'day' | 'week' | 'month';

export interface AnalyticsRangeInput {
  preset: RangePreset;
  /** Dhaka date-only 'YYYY-MM-DD'. Required for `custom`. */
  startDate?: string;
  /** Dhaka date-only 'YYYY-MM-DD'. Required for `custom`. */
  endDate?: string;
  /** Anchor instant (default: now). */
  now?: Date;
}

export interface AnalyticsRange {
  start: Date;
  end: Date;
  /** Inclusive Dhaka days in range. Always returned. */
  periodDays: number;
  granularity: Granularity;
  comparison: { prevStart: Date; prevEnd: Date };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default auto-granularity policy (§5 P3 trend). */
export function autoGranularity(periodDays: number): Granularity {
  if (periodDays <= 2) return 'hour';
  if (periodDays <= 62) return 'day';
  if (periodDays <= 185) return 'week';
  return 'month';
}

/** Inclusive containment of an instant in a resolved range. */
export function containsInstant(range: AnalyticsRange, at: Date): boolean {
  return at >= range.start && at <= range.end;
}

export function resolveAnalyticsRange(
  input: AnalyticsRangeInput,
): AnalyticsRange {
  const now = input.now ?? new Date();
  let start: Date;
  let end: Date;

  switch (input.preset) {
    case 'today':
      start = startOfDhakaDay(now);
      end = endOfDhakaDay(now);
      break;
    case 'yesterday': {
      const y = new Date(now.getTime() - DAY_MS);
      start = startOfDhakaDay(y);
      end = endOfDhakaDay(y);
      break;
    }
    case 'last_7_days':
      end = endOfDhakaDay(now);
      start = startOfDhakaDay(new Date(now.getTime() - 6 * DAY_MS));
      break;
    case 'last_30_days':
      end = endOfDhakaDay(now);
      start = startOfDhakaDay(new Date(now.getTime() - 29 * DAY_MS));
      break;
    case 'this_month': {
      const p = dhakaDateParts(now);
      start = new Date(Date.UTC(p.year, p.month - 1, 1) - DHAKA_OFFSET_MS);
      end = endOfDhakaDay(now);
      break;
    }
    case 'this_quarter': {
      const p = dhakaDateParts(now);
      const quarterMonth = Math.floor((p.month - 1) / 3) * 3;
      start = new Date(Date.UTC(p.year, quarterMonth, 1) - DHAKA_OFFSET_MS);
      end = endOfDhakaDay(now);
      break;
    }
    case 'this_year': {
      const p = dhakaDateParts(now);
      start = new Date(Date.UTC(p.year, 0, 1) - DHAKA_OFFSET_MS);
      end = endOfDhakaDay(now);
      break;
    }
    case 'custom': {
      if (!input.startDate || !input.endDate) {
        throw new Error(
          'custom preset requires both startDate and endDate (YYYY-MM-DD)',
        );
      }
      const s = dhakaDayRange(input.startDate);
      const e = dhakaDayRange(input.endDate);
      if (!s.start || !e.end) {
        throw new Error('unresolvable custom range dates');
      }
      start = s.start;
      end = e.end;
      break;
    }
  }

  if (end < start) {
    throw new Error('range end precedes range start');
  }

  const periodDays = Math.round((end.getTime() - start.getTime() + 1) / DAY_MS);
  const length = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - length);

  return {
    start,
    end,
    periodDays,
    granularity: autoGranularity(periodDays),
    comparison: { prevStart, prevEnd },
  };
}
