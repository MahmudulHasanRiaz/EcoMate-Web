import { BadRequestException } from '@nestjs/common';
import { dhakaDayRange, dhakaDateString } from '../../common/utils/dhaka-time';

/** Maximum supported date range in calendar days. */
const MAX_RANGE_DAYS = 7;

/**
 * Validated date-range window for monitoring queries.
 * All dates are interpreted as Dhaka business-day boundaries.
 */
export interface MonitoringDateRange {
  /** Absolute UTC start (inclusive) of the Dhaka day `from`. */
  from: Date;
  /** Absolute UTC end (inclusive) of the Dhaka day `to`. */
  to: Date;
  /** Original from string for display. */
  fromStr: string;
  /** Original to string for display. */
  toStr: string;
}

/**
 * Validate and resolve a monitoring date range from query parameters.
 * Dates must be YYYY-MM-DD format, interpreted as Dhaka business days.
 * Maximum range is 7 calendar days.
 */
export function validateDateRange(from?: string, to?: string): MonitoringDateRange {
  if (!from || !to) {
    throw new BadRequestException('Both from and to dates are required (YYYY-MM-DD format)');
  }

  // Validate YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(from)) {
    throw new BadRequestException(`Invalid from date format: "${from}". Expected YYYY-MM-DD`);
  }
  if (!dateRegex.test(to)) {
    throw new BadRequestException(`Invalid to date format: "${to}". Expected YYYY-MM-DD`);
  }

  // Validate actual dates (not just format)
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');
  if (isNaN(fromDate.getTime())) {
    throw new BadRequestException(`Invalid from date: "${from}"`);
  }
  if (isNaN(toDate.getTime())) {
    throw new BadRequestException(`Invalid to date: "${to}"`);
  }

  // Verify the date strings match actual dates (catches things like 2024-02-30)
  if (dhakaDateString(fromDate) !== from) {
    throw new BadRequestException(`Invalid from date: "${from}" is not a valid calendar date`);
  }
  if (dhakaDateString(toDate) !== to) {
    throw new BadRequestException(`Invalid to date: "${to}" is not a valid calendar date`);
  }

  // from <= to
  if (fromDate.getTime() > toDate.getTime()) {
    throw new BadRequestException(`from date (${from}) must not be after to date (${to})`);
  }

  // Max range check (7 calendar days)
  const diffMs = toDate.getTime() - fromDate.getTime();
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  if (diffDays > MAX_RANGE_DAYS) {
    throw new BadRequestException(
      `Date range exceeds maximum of ${MAX_RANGE_DAYS} calendar days (requested ${Math.ceil(diffDays)} days)`,
    );
  }

  // Resolve to Dhaka-day boundaries (absolute UTC instants)
  const fromRange = dhakaDayRange(from);
  const toRange = dhakaDayRange(to);

  if (!fromRange.start || !toRange.end) {
    throw new BadRequestException('Failed to resolve date range boundaries');
  }

  return {
    from: fromRange.start,
    to: toRange.end,
    fromStr: from,
    toStr: to,
  };
}

/**
 * Build a MonitoringDateRange for a preset.
 * All presets use Dhaka business-day boundaries.
 */
export function buildPresetRange(preset: 'today' | 'yesterday' | 'last7days'): MonitoringDateRange {
  const today = dhakaDateString(new Date());

  switch (preset) {
    case 'today': {
      const range = dhakaDayRange(today);
      return { from: range.start!, to: range.end!, fromStr: today, toStr: today };
    }
    case 'yesterday': {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const ydStr = dhakaDateString(yesterday);
      const range = dhakaDayRange(ydStr);
      return { from: range.start!, to: range.end!, fromStr: ydStr, toStr: ydStr };
    }
    case 'last7days': {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 6);
      const startStr = dhakaDateString(start);
      const endStr = dhakaDateString(end);
      const fromRange = dhakaDayRange(startStr);
      const toRange = dhakaDayRange(endStr);
      return { from: fromRange.start!, to: toRange.end!, fromStr: startStr, toStr: endStr };
    }
  }
}
