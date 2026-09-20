import { BadRequestException } from '@nestjs/common';
import { validateDateRange, buildPresetRange } from '../dto/monitoring.dto';
import { dhakaDateString, dhakaDayRange, DHAKA_OFFSET_MS } from '../../common/utils/dhaka-time';

describe('Monitoring Date Range DTO', () => {
  describe('validateDateRange', () => {
    it('accepts valid YYYY-MM-DD dates', () => {
      const result = validateDateRange('2026-09-15', '2026-09-15');
      expect(result.from).toBeInstanceOf(Date);
      expect(result.to).toBeInstanceOf(Date);
      expect(result.fromStr).toBe('2026-09-15');
      expect(result.toStr).toBe('2026-09-15');
    });

    it('rejects missing from date', () => {
      expect(() => validateDateRange(undefined, '2026-09-15')).toThrow(BadRequestException);
      expect(() => validateDateRange(undefined, '2026-09-15')).toThrow('Both from and to dates are required');
    });

    it('rejects missing to date', () => {
      expect(() => validateDateRange('2026-09-15', undefined)).toThrow(BadRequestException);
    });

    it('rejects invalid from format', () => {
      expect(() => validateDateRange('09-15-2026', '2026-09-15')).toThrow(BadRequestException);
      expect(() => validateDateRange('09-15-2026', '2026-09-15')).toThrow('Invalid from date format');
    });

    it('rejects invalid to format', () => {
      expect(() => validateDateRange('2026-09-15', '2026/09/15')).toThrow(BadRequestException);
      expect(() => validateDateRange('2026-09-15', '2026/09/15')).toThrow('Invalid to date format');
    });

    it('rejects invalid calendar dates', () => {
      expect(() => validateDateRange('2026-02-30', '2026-09-15')).toThrow(BadRequestException);
      expect(() => validateDateRange('2026-02-30', '2026-09-15')).toThrow('not a valid calendar date');
    });

    it('rejects from > to', () => {
      expect(() => validateDateRange('2026-09-20', '2026-09-15')).toThrow(BadRequestException);
      expect(() => validateDateRange('2026-09-20', '2026-09-15')).toThrow('must not be after');
    });

    it('rejects ranges exceeding 7 days', () => {
      expect(() => validateDateRange('2026-09-01', '2026-09-10')).toThrow(BadRequestException);
      expect(() => validateDateRange('2026-09-01', '2026-09-10')).toThrow('exceeds maximum of 7');
    });

    it('accepts exactly 7-day range', () => {
      const result = validateDateRange('2026-09-10', '2026-09-16');
      expect(result.from).toBeInstanceOf(Date);
      expect(result.to).toBeInstanceOf(Date);
    });

    it('resolves Dhaka-day boundaries correctly', () => {
      const result = validateDateRange('2026-09-15', '2026-09-15');
      // from should be 2026-09-14T18:00:00Z (Dhaka midnight - 6h offset)
      const expectedStart = new Date(Date.UTC(2026, 8, 15) - DHAKA_OFFSET_MS);
      expect(result.from.getTime()).toBe(expectedStart.getTime());
      // to should be end of day (start + 24h - 1ms)
      const expectedEnd = new Date(expectedStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      expect(result.to.getTime()).toBe(expectedEnd.getTime());
    });

    it('handles multi-day range boundaries', () => {
      const result = validateDateRange('2026-09-10', '2026-09-12');
      const expectedStart = new Date(Date.UTC(2026, 8, 10) - DHAKA_OFFSET_MS);
      const expectedEnd = new Date(Date.UTC(2026, 8, 12) - DHAKA_OFFSET_MS + 24 * 60 * 60 * 1000 - 1);
      expect(result.from.getTime()).toBe(expectedStart.getTime());
      expect(result.to.getTime()).toBe(expectedEnd.getTime());
    });
  });

  describe('buildPresetRange', () => {
    it('today returns current Dhaka day boundaries', () => {
      const result = buildPresetRange('today');
      const today = dhakaDateString(new Date());
      expect(result.fromStr).toBe(today);
      expect(result.toStr).toBe(today);
      expect(result.from).toBeInstanceOf(Date);
      expect(result.to).toBeInstanceOf(Date);
    });

    it('yesterday returns previous Dhaka day boundaries', () => {
      const result = buildPresetRange('yesterday');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const expected = dhakaDateString(yesterday);
      expect(result.fromStr).toBe(expected);
      expect(result.toStr).toBe(expected);
    });

    it('last7days spans 7 calendar days', () => {
      const result = buildPresetRange('last7days');
      expect(result.from).toBeInstanceOf(Date);
      expect(result.to).toBeInstanceOf(Date);
      // Range should be at most 7 days
      const diffMs = result.to.getTime() - result.from.getTime();
      const diffDays = diffMs / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeLessThanOrEqual(7);
      expect(diffDays).toBeGreaterThanOrEqual(6); // 7 calendar days inclusive
    });

    it('today and yesterday do not overlap', () => {
      const today = buildPresetRange('today');
      const yesterday = buildPresetRange('yesterday');
      expect(yesterday.to.getTime()).toBeLessThan(today.from.getTime());
    });
  });
});
