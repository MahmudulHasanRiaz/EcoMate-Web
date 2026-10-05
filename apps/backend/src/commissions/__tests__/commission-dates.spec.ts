import {
  normalizeEffectiveFrom,
  normalizeEffectiveTo,
  toDhakaDateString,
  validityWindowsOverlap,
} from '../commission-dates';

/**
 * Commission rule validity windows are Dhaka calendar days, inclusive at both
 * ends. These tests pin the exact instants those days map to, because the
 * engine compares them against an arbitrary instant and an off-by-one here
 * silently stops a rule paying on its own last day.
 */
describe('commission rule validity dates', () => {
  describe('normalizeEffectiveFrom — the first moment of the chosen day', () => {
    it('anchors a bare date to Dhaka midnight, not UTC midnight', () => {
      // 2026-11-01T00:00:00Z is 06:00 in Dhaka. Anchoring there would leave the
      // rule unpaid for the first six hours of the day it starts.
      expect(normalizeEffectiveFrom('2026-11-01')!.toISOString()).toBe('2026-10-31T18:00:00.000Z');
    });

    it('leaves an explicit instant untouched', () => {
      expect(normalizeEffectiveFrom('2026-11-01T10:00:00Z')!.toISOString()).toBe(
        '2026-11-01T10:00:00.000Z',
      );
    });

    it('preserves null, undefined and empty as null — endless is a real value', () => {
      expect(normalizeEffectiveFrom(null)).toBeNull();
      expect(normalizeEffectiveFrom(undefined)).toBeNull();
      expect(normalizeEffectiveFrom('')).toBeNull();
    });

    it('copies a Date rather than aliasing it', () => {
      const d = new Date('2026-11-01T10:00:00Z');
      const out = normalizeEffectiveFrom(d);
      expect(out!.toISOString()).toBe('2026-11-01T10:00:00.000Z');
      expect(out).not.toBe(d);
    });

    it('round-trips with toDhakaDateString', () => {
      expect(toDhakaDateString(normalizeEffectiveFrom('2026-11-01'))).toBe('2026-11-01');
    });
  });

  describe('normalizeEffectiveTo — the last moment of the chosen day', () => {
    it('extends to the end of the Dhaka day so the day itself still pays', () => {
      expect(normalizeEffectiveTo('2026-10-04')!.toISOString()).toBe('2026-10-04T17:59:59.999Z');
    });

    it('leaves an explicit instant untouched', () => {
      expect(normalizeEffectiveTo('2026-10-04T10:00:00Z')!.toISOString()).toBe(
        '2026-10-04T10:00:00.000Z',
      );
    });

    it('preserves null as endless', () => {
      expect(normalizeEffectiveTo(null)).toBeNull();
      expect(normalizeEffectiveTo(undefined)).toBeNull();
      expect(normalizeEffectiveTo('')).toBeNull();
    });

    it('round-trips with toDhakaDateString', () => {
      expect(toDhakaDateString(normalizeEffectiveTo('2026-10-04'))).toBe('2026-10-04');
    });
  });

  describe('a start and end on the SAME day is a valid one-day window', () => {
    it('orders correctly after normalisation', () => {
      const from = normalizeEffectiveFrom('2026-10-04')!;
      const to = normalizeEffectiveTo('2026-10-04')!;
      expect(to >= from).toBe(true);
    });

    it('rejects an end before the start', () => {
      const from = normalizeEffectiveFrom('2026-10-05')!;
      const to = normalizeEffectiveTo('2026-10-04')!;
      expect(to < from).toBe(true);
    });
  });

  describe('toDhakaDateString', () => {
    it('renders the Dhaka day, not the UTC day', () => {
      // 18:00 UTC is already the NEXT day in Dhaka. Slicing this would show the
      // wrong date to the operator — the bug this function exists to prevent.
      const dhakaMidnight = normalizeEffectiveFrom('2026-11-01')!;
      expect(dhakaMidnight.toISOString().slice(0, 10)).toBe('2026-10-31');
      expect(toDhakaDateString(dhakaMidnight)).toBe('2026-11-01');
    });

    it('returns null for a null date', () => {
      expect(toDhakaDateString(null)).toBeNull();
      expect(toDhakaDateString(undefined)).toBeNull();
    });

    it('pads single-digit months and days', () => {
      expect(toDhakaDateString(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
    });
  });

  describe('validityWindowsOverlap', () => {
    const win = (from: string | null, to: string | null) => ({
      effectiveFrom: normalizeEffectiveFrom(from),
      effectiveTo: normalizeEffectiveTo(to),
    });

    // The four cases the previous implementation got wrong.
    it('detects overlap when the new window CONTAINS the existing one', () => {
      expect(validityWindowsOverlap(win('2026-01-01', '2026-01-31'), win('2026-01-15', '2026-01-20'))).toBe(
        true,
      );
    });

    it('detects overlap when the existing window CONTAINS the new one', () => {
      expect(validityWindowsOverlap(win('2026-01-15', '2026-01-20'), win('2026-01-01', '2026-01-31'))).toBe(
        true,
      );
    });

    it('detects a partial overlap', () => {
      expect(validityWindowsOverlap(win('2026-01-10', '2026-01-20'), win('2026-01-15', '2026-01-25'))).toBe(
        true,
      );
    });

    it('reports no overlap for genuinely disjoint windows', () => {
      expect(validityWindowsOverlap(win('2026-01-01', '2026-01-10'), win('2026-01-15', '2026-01-25'))).toBe(
        false,
      );
    });

    it('treats touching windows as overlapping — both ends are inclusive', () => {
      // One ends on the 20th, the other starts on the 20th: they share a day.
      expect(validityWindowsOverlap(win('2026-01-01', '2026-01-20'), win('2026-01-20', '2026-01-31'))).toBe(
        true,
      );
    });

    it('treats any unbounded window as overlapping everything', () => {
      expect(validityWindowsOverlap(win(null, null), win('2026-01-15', '2026-01-20'))).toBe(true);
      expect(validityWindowsOverlap(win('2026-01-15', '2026-01-20'), win(null, null))).toBe(true);
      expect(validityWindowsOverlap(win(null, '2026-01-20'), win('2026-01-15', '2026-01-20'))).toBe(true);
      expect(validityWindowsOverlap(win('2026-01-15', null), win('2026-01-15', '2026-01-20'))).toBe(true);
    });

    it('reports no overlap between two disjoint unbounded-on-opposite-ends windows', () => {
      // Ended before the other started, even though each is open on one side.
      expect(validityWindowsOverlap(win(null, '2026-01-10'), win('2026-01-15', null))).toBe(false);
    });

    it('handles identical windows as overlapping', () => {
      expect(validityWindowsOverlap(win('2026-01-01', '2026-01-31'), win('2026-01-01', '2026-01-31'))).toBe(
        true,
      );
    });
  });
});