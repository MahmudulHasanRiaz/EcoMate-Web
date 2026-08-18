import {
  DHAKA_OFFSET_MS,
  dhakaNow,
  startOfDhakaDay,
  endOfDhakaDay,
  dhakaDateString,
  dhakaDateParts,
  dhakaDayRange,
  dhakaHourBucket,
  dhakaDayKey,
} from '../dhaka-time';

describe('dhaka-time (Asia/Dhaka, UTC+6, no DST)', () => {
  // A fixed instant: 2026-08-18T00:30:00Z = 2026-08-18 06:30 Dhaka
  const MORNING_UTC = new Date('2026-08-18T00:30:00.000Z');
  // 2026-08-17T18:00:00Z = 2026-08-18 00:00 Dhaka
  const DHAKA_MIDNIGHT_UTC = new Date('2026-08-17T18:00:00.000Z');
  // 2026-08-18T03:45:00Z = 2026-08-18 09:45 Dhaka
  const LATE_MORNING_UTC = new Date('2026-08-18T03:45:00.000Z');
  // 2026-08-18T23:30:00Z = 2026-08-19 05:30 Dhaka (crosses into next Dhaka day)
  const AFTER_DHAKA_MIDNIGHT_UTC = new Date('2026-08-18T23:30:00.000Z');

  it('exposes the fixed +6h offset', () => {
    expect(DHAKA_OFFSET_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('dhakaNow carries Dhaka wall-clock components (UTC+6 shift)', () => {
    const n = dhakaNow();
    // UTC components of dhakaNow == Dhaka components of the real now.
    const real = new Date();
    expect(n.getUTCHours()).toBe((real.getUTCHours() + 6) % 24);
    expect(n.getUTCMinutes()).toBe(real.getUTCMinutes());
  });

  describe('startOfDhakaDay', () => {
    it('returns the Dhaka midnight instant of the containing day', () => {
      expect(startOfDhakaDay(MORNING_UTC).getTime()).toBe(DHAKA_MIDNIGHT_UTC.getTime());
      expect(startOfDhakaDay(LATE_MORNING_UTC).getTime()).toBe(DHAKA_MIDNIGHT_UTC.getTime());
    });

    it('handles instants after Dhaka midnight (UTC evening)', () => {
      // 2026-08-19 00:00 Dhaka = 2026-08-18T18:00:00Z
      expect(startOfDhakaDay(AFTER_DHAKA_MIDNIGHT_UTC).toISOString()).toBe(
        '2026-08-18T18:00:00.000Z',
      );
    });
  });

  describe('endOfDhakaDay', () => {
    it('is 23:59:59.999 Dhaka of the same day', () => {
      const end = endOfDhakaDay(MORNING_UTC);
      const start = startOfDhakaDay(MORNING_UTC);
      expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
      // 2026-08-18 23:59:59.999 Dhaka = 2026-08-18T17:59:59.999Z
      expect(end.toISOString()).toBe('2026-08-18T17:59:59.999Z');
    });
  });

  describe('dhakaDateString / dhakaDateParts / dhakaDayKey', () => {
    it('returns the Dhaka calendar day for UTC-evening instants', () => {
      // 2026-08-18T23:30Z is Aug 19 in Dhaka
      expect(dhakaDateString(AFTER_DHAKA_MIDNIGHT_UTC)).toBe('2026-08-19');
      expect(dhakaDateString(MORNING_UTC)).toBe('2026-08-18');
      expect(dhakaDayKey(AFTER_DHAKA_MIDNIGHT_UTC)).toBe('2026-08-19');
    });

    it('dhakaDateParts matches dhakaDateString', () => {
      const p = dhakaDateParts(AFTER_DHAKA_MIDNIGHT_UTC);
      expect(p).toEqual({ year: 2026, month: 8, day: 19 });
      const d = dhakaDateParts(MORNING_UTC);
      expect(d).toEqual({ year: 2026, month: 8, day: 18 });
    });

    it('defaults to now', () => {
      expect(dhakaDateParts()).toBeDefined();
      expect(typeof dhakaDateString()).toBe('string');
    });
  });

  describe('dhakaDayRange', () => {
    it('interprets a date-only string as a Dhaka calendar day', () => {
      const { start, end } = dhakaDayRange('2026-08-18');
      // 00:00 Dhaka = 2026-08-17T18:00:00Z
      expect(start!.toISOString()).toBe('2026-08-17T18:00:00.000Z');
      // end is INCLUSIVE: 23:59:59.999 Dhaka = 2026-08-18T17:59:59.999Z
      expect(end!.toISOString()).toBe('2026-08-18T17:59:59.999Z');
      expect(end!.getTime() - start!.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
    });

    it('returns nulls for empty input', () => {
      expect(dhakaDayRange('')).toEqual({ start: null, end: null });
    });

    it('passes full ISO instants through unchanged', () => {
      const iso = '2026-08-18T07:00:00.000Z';
      const r = dhakaDayRange(iso);
      expect(r.start!.toISOString()).toBe(iso);
      expect(r.end!.toISOString()).toBe(iso);
    });

    it('tolerates month boundaries', () => {
      const { start, end } = dhakaDayRange('2026-08-01');
      // 2026-07-31T18:00:00Z = 2026-08-01 00:00 Dhaka
      expect(start!.toISOString()).toBe('2026-07-31T18:00:00.000Z');
      expect(end!.getTime() - start!.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
    });
  });

  describe('dhakaHourBucket', () => {
    it('truncates to the containing Dhaka hour as a UTC instant', () => {
      // 2026-08-18 09:45 Dhaka → 09:00 Dhaka = 2026-08-18T03:00:00Z
      expect(dhakaHourBucket(LATE_MORNING_UTC).toISOString()).toBe(
        '2026-08-18T03:00:00.000Z',
      );
    });

    it('buckets instants right after a Dhaka hour boundary', () => {
      // 2026-08-18 06:00:01 Dhaka = 2026-08-18T00:00:01Z → 06:00 Dhaka = 00:00Z
      const t = new Date('2026-08-18T00:00:01.000Z');
      expect(dhakaHourBucket(t).toISOString()).toBe('2026-08-18T00:00:00.000Z');
    });
  });
});