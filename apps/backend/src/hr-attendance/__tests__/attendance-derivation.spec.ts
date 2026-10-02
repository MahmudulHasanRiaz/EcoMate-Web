import {
  deriveDayMetrics,
  detectOvernight,
  parseWallClock,
  shiftWindowFor,
  NO_SHIFT_METRICS,
  type DerivableShift,
  type SessionPunch,
} from '../attendance-derivation';

/** 2026-08-24 as a stored-convention business day (UTC midnight). */
const DAY = new Date('2026-08-24T00:00:00.000Z');

/** 09:00–17:00, 10m grace, 60m break ⇒ 7h (420m) standard. */
const GENERAL: DerivableShift = {
  startTime: '09:00',
  endTime: '17:00',
  graceMinutes: 10,
  breakMinutes: 60,
  standardMinutes: 420,
  overnight: false,
};

/** Instant for a "HH:mm" wall-clock time on the business day (or +N days). */
const at = (hhmm: string, dayOffsetDays = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(DAY.getTime() + (h * 60 + m) * 60000 + dayOffsetDays * 86400000);
};

/** Punches on the business day, or the NEXT day for an overnight check-out. */
const punch = (inH: string, outH: string | null): SessionPunch => ({
  checkInAt: at(inH),
  checkOutAt: outH === null ? null : at(outH),
});

const derive = (shift: DerivableShift | null, sessions: SessionPunch[], worked: number) =>
  deriveDayMetrics({ day: DAY, workedMinutes: worked, shift, sessions, at: at('23:00') });

describe('parseWallClock', () => {
  it('converts HH:mm to minutes past midnight', () => {
    expect(parseWallClock('00:00')).toBe(0);
    expect(parseWallClock('09:00')).toBe(540);
    expect(parseWallClock('17:30')).toBe(1050);
  });

  it('accepts a single-digit hour', () => {
    expect(parseWallClock('9:05')).toBe(545);
  });

  it('rejects malformed or out-of-range values', () => {
    expect(() => parseWallClock('25:00')).toThrow();
    expect(() => parseWallClock('09:60')).toThrow();
    expect(() => parseWallClock('abc')).toThrow();
    expect(() => parseWallClock('')).toThrow();
  });
});

describe('detectOvernight', () => {
  it('is false when the end is after the start', () => {
    expect(detectOvernight('09:00', '17:00')).toBe(false);
  });

  it('is true when the shift crosses midnight', () => {
    expect(detectOvernight('22:00', '06:00')).toBe(true);
  });
});

describe('shiftWindowFor', () => {
  it('brackets the business day for a day shift', () => {
    const w = shiftWindowFor(DAY, { startTime: '09:00', endTime: '17:00', overnight: false });
    expect(w.start.toISOString()).toBe('2026-08-24T09:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-08-24T17:00:00.000Z');
  });

  it('closes on the NEXT day for an overnight shift', () => {
    const w = shiftWindowFor(DAY, { startTime: '22:00', endTime: '06:00', overnight: true });
    expect(w.start.toISOString()).toBe('2026-08-24T22:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-08-25T06:00:00.000Z');
  });
});

describe('deriveDayMetrics — no shift', () => {
  it('leaves every metric unresolved rather than zero', () => {
    // A weekly-off day or a day recorded before shifts existed must never
    // accumulate phantom overtime.
    const res = derive(null, [punch('09:00', '17:00')], 420);
    expect(res).toEqual(NO_SHIFT_METRICS);
    expect(res.overtimeMinutes).toBeNull();
    expect(res.scheduledMinutes).toBeNull();
  });

  it('is safe with no sessions at all', () => {
    expect(derive(null, [], 0)).toEqual(NO_SHIFT_METRICS);
  });
});

describe('deriveDayMetrics — overtime', () => {
  it('is exactly zero on a standard-length day', () => {
    const res = derive(GENERAL, [punch('09:00', '17:00')], 420);
    expect(res.overtimeMinutes).toBe(0);
    expect(res.scheduledMinutes).toBe(420);
  });

  it('is NET: one hour late and one hour past the end nets to zero', () => {
    // The person did not put in extra hours; counting gross time would reward
    // arriving late with overtime.
    const res = derive(GENERAL, [punch('10:00', '18:00')], 420);
    expect(res.overtimeMinutes).toBe(0);
    expect(res.lateMinutes).toBe(50); // 60m late, 10m grace absorbed
  });

  it('credits the surplus after a late start', () => {
    // 480 worked against a 420 standard ⇒ 60 of surplus, minus 50 late = 10.
    const res = derive(GENERAL, [punch('10:00', '19:00')], 480);
    expect(res.overtimeMinutes).toBe(60);
    expect(res.lateMinutes).toBe(50);
  });

  it('floors at zero on a short day and never reports negative overtime', () => {
    const res = derive(GENERAL, [punch('09:00', '13:00')], 180);
    expect(res.overtimeMinutes).toBe(0);
  });

  it('sums overtime across multiple sessions in the same day', () => {
    const res = derive(GENERAL, [punch('09:00', '12:00'), punch('16:00', '20:00')], 420);
    expect(res.overtimeMinutes).toBe(0);
  });
});

describe('deriveDayMetrics — lateness and early leave', () => {
  it('is ZERO inside the grace period', () => {
    // 09:00 start with 10m grace ⇒ 09:08 is not late.
    const res = derive(GENERAL, [punch('09:08', '17:00')], 412);
    expect(res.lateMinutes).toBe(0);
  });

  it('measures the surplus past grace, not the raw distance', () => {
    // 09:30 is 30m after the start; 10m of that is grace ⇒ 20m late.
    const res = derive(GENERAL, [punch('09:30', '17:00')], 420);
    expect(res.lateMinutes).toBe(20);
  });

  it('measures lateness from the shift start, not from some later point', () => {
    const res = derive(GENERAL, [punch('10:00', '19:00')], 480);
    expect(res.lateMinutes).toBe(50);
  });

  it('is zero for an early departure that ends before the shift closes', () => {
    // Leaving at 15:00 vs a 17:00 shift is 120m early, but only 110m past grace.
    const res = derive(GENERAL, [punch('09:00', '15:00')], 300);
    expect(res.earlyLeaveMinutes).toBe(110);
  });

  it('is zero when the last session ends after the shift', () => {
    const res = derive(GENERAL, [punch('09:00', '19:00')], 480);
    expect(res.earlyLeaveMinutes).toBe(0);
  });

  it('uses the EARLIEST check-in of the day', () => {
    // 09:30 is the earliest of the two sessions, so it sets lateness: 30m past
    // the 09:00 start, less 10m grace.
    const res = derive(GENERAL, [punch('11:00', '12:00'), punch('09:30', '18:00')], 480);
    expect(res.lateMinutes).toBe(20);
  });

  it('measures an open session to the supplied instant', () => {
    // Still working at 11:00, so no early departure has happened yet.
    const res = deriveDayMetrics({
      day: DAY,
      workedMinutes: 120,
      shift: GENERAL,
      sessions: [{ checkInAt: at('09:00'), checkOutAt: null }],
      at: at('11:00'),
    });
    expect(res.earlyLeaveMinutes).toBe(0);
    expect(res.outsideShift).toBe(false);
  });
});

describe('deriveDayMetrics — work outside the shift', () => {
  it('flags a session entirely after the shift', () => {
    const res = derive(GENERAL, [punch('19:00', '22:00')], 180);
    expect(res.outsideShift).toBe(true);
    expect(res.overtimeMinutes).toBe(0);
  });

  it('flags a session entirely before the shift', () => {
    const res = derive(GENERAL, [punch('05:00', '08:00')], 180);
    expect(res.outsideShift).toBe(true);
  });

  it('does NOT flag a session that merely straddles the boundary', () => {
    // 16:00–20:00 overlaps the 09:00–17:00 window, so it is in-shift overtime.
    const res = derive(GENERAL, [punch('16:00', '20:00')], 240);
    expect(res.outsideShift).toBe(false);
  });

  it('is false when all work falls inside the shift', () => {
    const res = derive(GENERAL, [punch('09:00', '17:00')], 420);
    expect(res.outsideShift).toBe(false);
  });
});

describe('deriveDayMetrics — overnight shift', () => {
  const NIGHT: DerivableShift = {
    startTime: '22:00',
    endTime: '06:00',
    graceMinutes: 10,
    breakMinutes: 60,
    standardMinutes: 420,
    overnight: true,
  };

  // A 22:00 → 06:00 shift: check-in on the business day, check-out the next.
  const nightPunch = (inH: string, outH: string): SessionPunch => ({
    checkInAt: at(inH),
    checkOutAt: at(outH, 1),
  });

  it('measures lateness against the night start', () => {
    // 23:00 is 60m after the 22:00 start; 10m grace ⇒ 50m late.
    const res = derive(NIGHT, [nightPunch('23:00', '06:00')], 420);
    expect(res.lateMinutes).toBe(50);
  });

  it('does not read a check-out at the shift end as leaving early', () => {
    // 06:00 IS the shift end, so nothing was missed.
    const res = derive(NIGHT, [nightPunch('22:00', '06:00')], 420);
    expect(res.earlyLeaveMinutes).toBe(0);
  });

  it('flags a daytime session as outside a night shift', () => {
    const res = derive(NIGHT, [punch('09:00', '12:00')], 180);
    expect(res.outsideShift).toBe(true);
  });

  it('does not flag a session that starts before the night shift', () => {
    // 21:00–23:00 overlaps 22:00–06:00, so it is in-shift work.
    const res = derive(NIGHT, [punch('21:00', '23:00')], 120);
    expect(res.outsideShift).toBe(false);
  });
});