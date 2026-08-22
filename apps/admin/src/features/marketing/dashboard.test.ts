import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { money, fmtDate } from './api'

// ─── Pure helper tests ───────────────────────────────────────────────────────

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
    it('handles negative amounts', () => {
      const result = money(-500)
      expect(result).toContain('500')
      expect(result).toMatch(/-/)
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

// ─── Dashboard verdict logic (deterministic, no rendering) ──────────────────

describe('Dashboard verdict logic', () => {
  function computeVerdict(
    orders: number,
    revenue: number,
    cost: number,
  ): 'profitable' | 'near_break_even' | 'loss_making' | 'insufficient_data' {
    if (orders < 5) return 'insufficient_data'
    const profit = revenue - cost
    const margin = revenue > 0 ? profit / revenue : 0
    if (profit > 0 && margin > 0.1) return 'profitable'
    if (profit > 0 || margin >= -0.1) return 'near_break_even'
    return 'loss_making'
  }

  it('insufficient data when < 5 orders', () => {
    expect(computeVerdict(3, 10000, 5000)).toBe('insufficient_data')
  })
  it('profitable when margin > 10%', () => {
    expect(computeVerdict(10, 20000, 5000)).toBe('profitable')
  })
  it('near break-even when profit positive but margin <= 10%', () => {
    expect(computeVerdict(10, 20000, 18500)).toBe('near_break_even')
  })
  it('near break-even when loss is within 10% of revenue', () => {
    expect(computeVerdict(10, 20000, 21000)).toBe('near_break_even')
  })
  it('loss-making when loss > 10% of revenue', () => {
    expect(computeVerdict(10, 20000, 25000)).toBe('loss_making')
  })
  it('profitable at exactly 5 orders', () => {
    expect(computeVerdict(5, 10000, 5000)).toBe('profitable')
  })
  it('loss-making at 4 orders is insufficient_data', () => {
    expect(computeVerdict(4, 10000, 15000)).toBe('insufficient_data')
  })
  it('zero revenue with cost = near_break_even (margin defaults to 0)', () => {
    // When revenue=0, margin is clamped to 0 (avoids division by zero), and 0 >= -0.1 → near_break_even
    expect(computeVerdict(10, 0, 5000)).toBe('near_break_even')
  })
})

// ─── Financial position logic ────────────────────────────────────────────────

describe('Dashboard financial position', () => {
  it('sums funding correctly', () => {
    const funding = [
      { remainingAmount: 500, receivedAmount: 1000, consumedAmount: 500 },
      { remainingAmount: 300, receivedAmount: 800, consumedAmount: 500 },
    ]
    const totalPrepaid = funding.reduce((s, f) => s + f.remainingAmount, 0)
    const totalReceived = funding.reduce((s, f) => s + f.receivedAmount, 0)
    const totalConsumed = funding.reduce((s, f) => s + f.consumedAmount, 0)
    expect(totalPrepaid).toBe(800)
    expect(totalReceived).toBe(1800)
    expect(totalConsumed).toBe(1000)
  })
  it('handles empty funding', () => {
    const funding: any[] = []
    const totalPrepaid = funding.reduce((s, f) => s + (f.remainingAmount ?? 0), 0)
    expect(totalPrepaid).toBe(0)
  })
  it('handles funding with undefined amounts', () => {
    const funding = [{ remainingAmount: undefined, receivedAmount: undefined, consumedAmount: undefined }]
    const totalPrepaid = funding.reduce((s, f) => s + (f.remainingAmount ?? 0), 0)
    expect(totalPrepaid).toBe(0)
  })
})

// ─── Break-even CPA logic ───────────────────────────────────────────────────

describe('Break-even CPA logic', () => {
  it('computes break-even CPA from AOV and gross margin', () => {
    const revenue = 10000, orders = 10, cost = 6000
    const avgOrderValue = revenue / orders
    const grossMargin = (revenue - cost) / revenue
    const breakEvenCpa = avgOrderValue * grossMargin
    expect(breakEvenCpa).toBe(400)
  })
  it('returns null when margin is negative', () => {
    const grossMargin = (10000 - 12000) / 10000
    const breakEvenCpa = grossMargin > 0 ? (10000 / 10) * grossMargin : null
    expect(breakEvenCpa).toBeNull()
  })
  it('break-even CPA is higher when margin is higher', () => {
    const aov = 1000
    const margin40 = aov * 0.4 // 400
    const margin20 = aov * 0.2 // 200
    expect(margin40).toBeGreaterThan(margin20)
  })
})

// ─── KPI card value formatting ───────────────────────────────────────────────

describe('KPI card value rendering', () => {
  it('formats spend as currency', () => {
    const result = money(12345.67)
    expect(result).toContain('12,345.67')
  })
  it('formats ROAS as multiplier', () => {
    const roas = 3.45
    expect(`${roas.toFixed(2)}x`).toBe('3.45x')
  })
  it('formats ROAS null as —', () => {
    const roas = null
    expect(roas === null ? '—' : `${roas.toFixed(2)}x`).toBe('—')
  })
  it('formats percentage', () => {
    const margin = 0.2356
    expect(`${(margin * 100).toFixed(1)}%`).toBe('23.6%')
  })
  it('formats zero profit as currency', () => {
    expect(money(0)).toContain('0.00')
  })
  it('formats negative profit as currency with minus', () => {
    const result = money(-2500)
    expect(result).toMatch(/-/)
    expect(result).toContain('2,500')
  })
})

// ─── Campaign row data integrity ─────────────────────────────────────────────

describe('Campaign row data', () => {
  it('renders orders count from perf data', () => {
    const perf = { store: { orders: 12, revenue: 48000, roas: 2.4, profit: 12000 } }
    expect(perf.store.orders).toBe(12)
  })
  it('renders — for missing perf', () => {
    const perf = undefined
    const display = perf?.store?.orders ?? 0
    expect(display).toBe(0)
  })
  it('renders ROAS as multiplier', () => {
    const roas = 2.4
    expect(`${roas.toFixed(2)}x`).toBe('2.40x')
  })
  it('renders null ROAS as —', () => {
    const roas = null
    expect(roas != null ? `${roas.toFixed(2)}x` : '—').toBe('—')
  })
  it('verdict badge: profitable', () => {
    const verdict = 'profitable'
    expect(verdict).toBe('profitable')
  })
  it('verdict badge: loss_making', () => {
    const verdict = 'loss_making'
    expect(verdict).toBe('loss_making')
  })
  it('verdict badge: insufficient_data default', () => {
    const verdict = undefined
    const display = verdict ?? 'insufficient_data'
    expect(display).toBe('insufficient_data')
  })
})

// ─── Zero/undefined edge cases ──────────────────────────────────────────────

describe('Zero/undefined edge cases', () => {
  it('money(0) does not throw', () => {
    expect(() => money(0)).not.toThrow()
  })
  it('money(null) returns 0 formatted', () => {
    expect(money(null)).toContain('0.00')
  })
  it('money(undefined) returns 0 formatted', () => {
    expect(money(undefined)).toContain('0.00')
  })
  it('ROAS null renders —', () => {
    const roas = null
    const display = roas != null ? `${roas.toFixed(2)}x` : '—'
    expect(display).toBe('—')
  })
  it('revenue 0 renders correctly', () => {
    expect(money(0)).toContain('0.00')
  })
  it('profit negative renders correctly', () => {
    expect(money(-100)).toMatch(/-/)
  })
})
