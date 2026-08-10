import {
  resolveEventTimeSeconds,
  toMetaEventTime,
  toTikTokTimestamp,
  toGa4Micros,
} from '../tracking-time';

describe('tracking-time (canonical provider timestamp contract)', () => {
  describe('resolveEventTimeSeconds', () => {
    it('passes a valid unix-seconds value through, floored', () => {
      expect(resolveEventTimeSeconds(1722600000.9)).toBe(1722600000);
    });

    it('falls back to now for undefined', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-10T12:00:00Z'));
      const expected = Math.floor(Date.now() / 1000);
      expect(resolveEventTimeSeconds()).toBe(expected);
      jest.useRealTimers();
    });

    it('falls back to now for malformed values (NaN / 0 / negative / Infinity)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-10T12:00:00Z'));
      const expected = Math.floor(Date.now() / 1000);
      expect(resolveEventTimeSeconds(NaN)).toBe(expected);
      expect(resolveEventTimeSeconds(0)).toBe(expected);
      expect(resolveEventTimeSeconds(-5)).toBe(expected);
      expect(resolveEventTimeSeconds(Infinity)).toBe(expected);
      jest.useRealTimers();
    });
  });

  describe('toTikTokTimestamp — P0 fix (v1.3 pixel/track requires ISO 8601 STRING)', () => {
    it('serializes unix seconds as an ISO 8601 UTC string', () => {
      expect(toTikTokTimestamp(1722600000)).toBe('2024-08-02T12:00:00.000Z');
    });

    it('always yields a string — a JSON number would be rejected with 40002', () => {
      expect(typeof toTikTokTimestamp(1722600000)).toBe('string');
      expect(Number.isNaN(Date.parse(toTikTokTimestamp(1722600000)))).toBe(false);
    });

    it('falls back to dispatch time when the snapshot carries none', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-10T12:00:00Z'));
      expect(toTikTokTimestamp()).toBe('2026-08-10T12:00:00.000Z');
      jest.useRealTimers();
    });
  });

  describe('toMetaEventTime / toGa4Micros', () => {
    it('Meta event_time stays integer unix seconds', () => {
      expect(toMetaEventTime(1722600000)).toBe(1722600000);
      expect(typeof toMetaEventTime(1722600000)).toBe('number');
    });

    it('GA4 timestamp_micros is the unix seconds × 1e6', () => {
      expect(toGa4Micros(1722600000)).toBe(1722600000000000);
    });
  });
});