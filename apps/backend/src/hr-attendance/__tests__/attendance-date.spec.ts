import {
  DHAKA_TZ,
  dhakaToday,
  dhakaDateOf,
  parseLocalDate,
  dhakaStartOfDay,
  dhakaRangeForToday,
} from '../attendance-date';

describe('attendance-date (Asia/Dhaka business date for attendance)', () => {
  it('exposes the Asia/Dhaka timezone constant', () => {
    expect(DHAKA_TZ).toBe('Asia/Dhaka');
  });

  it('dhakaToday returns the Dhaka calendar date as YYYY-MM-DD', () => {
    // 2026-08-24T18:30:00Z = 2026-08-25 00:30 Dhaka (crosses Dhaka midnight)
    const crossMidnight = new Date('2026-08-24T18:30:00.000Z');
    expect(dhakaToday(crossMidnight)).toBe('2026-08-25');
    // 2026-08-24T17:59:59Z = 2026-08-24 23:59:59 Dhaka (same Dhaka day)
    expect(dhakaToday(new Date('2026-08-24T17:59:59.000Z'))).toBe('2026-08-24');
    // mid-morning UTC is the same Dhaka calendar day
    expect(dhakaToday(new Date('2026-08-28T08:30:00.000Z'))).toBe('2026-08-28');
  });

  it('dhakaDateOf maps an instant to its Dhaka business-date string', () => {
    expect(dhakaDateOf(new Date('2026-08-24T18:30:00.000Z'))).toBe('2026-08-25');
    expect(dhakaDateOf(new Date('2026-08-28T08:30:00.000Z'))).toBe('2026-08-28');
  });

  it('parseLocalDate validates and normalizes YYYY-MM-DD to UTC midnight', () => {
    expect(parseLocalDate('2026-08-25').toISOString()).toBe(
      '2026-08-25T00:00:00.000Z',
    );
    expect(parseLocalDate('2026-08-25').getUTCHours()).toBe(0);
  });

  it('parseLocalDate rejects malformed dates', () => {
    expect(() => parseLocalDate('not-a-date')).toThrow();
    expect(() => parseLocalDate('2026-13-40')).toThrow();
  });

  it('dhakaStartOfDay builds the stored UTC-midnight convention', () => {
    expect(dhakaStartOfDay('2026-08-25').toISOString()).toBe(
      '2026-08-25T00:00:00.000Z',
    );
  });

  it('dhakaRangeForToday spans [Dhaka today, +1 day)', () => {
    // now = 2026-08-24T18:30Z → Dhaka business date 2026-08-25
    const { from, to } = dhakaRangeForToday(new Date('2026-08-24T18:30:00.000Z'));
    expect(from.toISOString()).toBe('2026-08-25T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });

  it('dhakaRangeForToday defaults to the real now', () => {
    const { from, to } = dhakaRangeForToday();
    expect(to.getTime() - from.getTime()).toBe(86400000);
  });
});
