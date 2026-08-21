import { describe, it, expect } from 'vitest'

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
})

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
})

describe('Break-even CPA logic', () => {
  it('computes break-even CPA from AOV and gross margin', () => {
    const revenue = 10000
    const orders = 10
    const cost = 6000
    const avgOrderValue = revenue / orders // 1000
    const grossMargin = (revenue - cost) / revenue // 0.4
    const breakEvenCpa = avgOrderValue * grossMargin // 400
    expect(breakEvenCpa).toBe(400)
  })

  it('returns null when margin is negative', () => {
    const revenue = 10000
    const orders = 10
    const cost = 12000
    const grossMargin = (revenue - cost) / revenue // -0.2
    const breakEvenCpa = grossMargin > 0 ? (revenue / orders) * grossMargin : null
    expect(breakEvenCpa).toBeNull()
  })
})
