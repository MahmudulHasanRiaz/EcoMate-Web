import { BadRequestException } from '@nestjs/common';
import { resolveAnalyticsRange } from '../business-analytics/analytics-range.util';
import {
  DHAKA_OFFSET_MS,
  dhakaDateParts,
  dhakaDateString,
  dhakaDayRange,
} from '../common/utils/dhaka-time';
import {
  POS_ANALYTICS_PRESETS,
  PosAnalyticsPreset,
} from './dto/pos-analytics-query.dto';

export const POS_FORMULA_VERSION = 'pos-analytics-v1';
export const POS_DATE_BASIS = 'payment-completion (Asia/Dhaka)';

/** Custom From–To ranges longer than this are rejected (presets need no cap). */
export const CUSTOM_RANGE_MAX_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PosRange {
  start: Date;
  end: Date;
  /** Dhaka YYYY-MM-DD of range start (for meta + filenames). */
  from: string;
  /** Dhaka YYYY-MM-DD of range end. */
  to: string;
  periodDays: number;
}

function asDate(value: Date | null, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestException(`unresolvable range date: ${label}`);
  }
  return value;
}

/**
 * Resolve the reporting window. Reuses the shared analytics-range presets
 * (today/yesterday/last_7_days/last_30_days/this_month) and dhaka-time day
 * math; only `previous_month` (absent there) and the 366-day custom cap are
 * POS-specific. Explicit from/to always wins and is validated as custom.
 */
export function resolvePosRange(
  input: { preset?: string; from?: string; to?: string },
  now: Date = new Date(),
): PosRange {
  const preset = input.preset ?? 'today';
  const { from, to } = input;

  if (from || to) {
    if (!from || !to) {
      throw new BadRequestException(
        'custom range requires both from and to (YYYY-MM-DD)',
      );
    }
    const s = dhakaDayRange(from);
    const e = dhakaDayRange(to);
    const start = asDate(s.start, `from=${from}`);
    const end = asDate(e.end, `to=${to}`);
    if (end < start) {
      throw new BadRequestException('from must not be after to');
    }
    const periodDays = Math.round((end.getTime() - start.getTime() + 1) / DAY_MS);
    if (periodDays > CUSTOM_RANGE_MAX_DAYS) {
      throw new BadRequestException(
        `custom range capped at ${CUSTOM_RANGE_MAX_DAYS} days (received ${periodDays})`,
      );
    }
    return { start, end, from, to, periodDays };
  }

  if (!(POS_ANALYTICS_PRESETS as readonly string[]).includes(preset)) {
    throw new BadRequestException(`unknown preset: ${preset}`);
  }
  if (preset === 'custom') {
    throw new BadRequestException(
      'custom preset requires both from and to (YYYY-MM-DD)',
    );
  }

  if (preset === 'previous_month') {
    const p = dhakaDateParts(now);
    const prevYear = p.month === 1 ? p.year - 1 : p.year;
    const prevMonth = p.month === 1 ? 12 : p.month - 1;
    const start = new Date(Date.UTC(prevYear, prevMonth - 1, 1) - DHAKA_OFFSET_MS);
    // Start of the current Dhaka month, minus 1ms = end of previous month.
    const end = new Date(
      Date.UTC(p.year, p.month - 1, 1) - DHAKA_OFFSET_MS - 1,
    );
    const periodDays = Math.round((end.getTime() - start.getTime() + 1) / DAY_MS);
    return {
      start,
      end,
      from: dhakaDateString(start),
      to: dhakaDateString(end),
      periodDays,
    };
  }

  const r = resolveAnalyticsRange({
    preset: preset as PosAnalyticsPreset & 'today',
    now,
  });
  return {
    start: r.start,
    end: r.end,
    from: dhakaDateString(r.start),
    to: dhakaDateString(r.end),
    periodDays: r.periodDays,
  };
}
