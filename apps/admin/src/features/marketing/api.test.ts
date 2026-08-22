import { describe, it, expect, vi, beforeEach } from 'vitest'
import { money, fmtDate } from './api'

describe('marketing API helpers', () => {
  describe('money()', () => {
    it('formats BDT by default', () => {
      expect(money(1234.5)).toContain('1,234.50')
    })
    it('formats USD when specified', () => {
      const result = money(99.9, 'USD')
      expect(result).toContain('99.90')
    })
    it('handles zero', () => {
      expect(money(0)).toContain('0.00')
    })
    it('handles null/undefined', () => {
      expect(money(null)).toContain('0.00')
      expect(money(undefined)).toContain('0.00')
    })
    it('handles string amounts', () => {
      expect(money('1234.5')).toContain('1,234.50')
    })
  })

  describe('fmtDate()', () => {
    it('formats ISO date strings', () => {
      const result = fmtDate('2026-08-15T00:00:00Z')
      expect(result).toContain('Aug')
      expect(result).toContain('2026')
    })
    it('returns — for null/undefined', () => {
      expect(fmtDate(null)).toBe('—')
      expect(fmtDate(undefined)).toBe('—')
    })
  })
})
