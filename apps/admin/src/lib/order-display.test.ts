import { describe, it, expect } from 'vitest'
import { getOrderPaidAmount, getOrderDueAmount } from './order-display'

describe('getOrderPaidAmount', () => {
  it('returns 0 for a null/undefined order', () => {
    expect(getOrderPaidAmount(null)).toBe(0)
    expect(getOrderPaidAmount(undefined)).toBe(0)
  })

  it('returns 0 for a plain cash-on-delivery order with no payments', () => {
    expect(
      getOrderPaidAmount({ total: 1500, paymentOptionType: 'CASH_ON_DELIVERY' }),
    ).toBe(0)
  })

  it('sums only paid/verified/completed payments', () => {
    const paid = getOrderPaidAmount({
      total: 1500,
      paymentOptionType: 'PARTIAL_PAYMENT',
      payments: [
        { amount: 500, status: 'PAID' },
        { amount: 300, status: 'VERIFIED' },
        { amount: 200, status: 'COMPLETED' },
        { amount: 999, status: 'PENDING' },
        { amount: 999, status: 'FAILED' },
        { amount: 999, status: 'CANCELLED' },
        { amount: 999, status: 'REFUNDED' },
      ],
    })
    expect(paid).toBe(1000)
  })

  it('matches status case-insensitively', () => {
    expect(
      getOrderPaidAmount({ total: 1500, payments: [{ amount: 500, status: 'paid' }] }),
    ).toBe(500)
  })

  it('falls back to total when paymentStatus is PAID', () => {
    expect(getOrderPaidAmount({ total: 1500, paymentStatus: 'PAID' })).toBe(1500)
  })

  it('falls back to total for FULL_PAYMENT', () => {
    expect(
      getOrderPaidAmount({ total: 1500, paymentOptionType: 'FULL_PAYMENT' }),
    ).toBe(1500)
  })

  it('uses partialAmount for a partial order with no recorded payments', () => {
    expect(
      getOrderPaidAmount({
        total: 1500,
        paymentOptionType: 'PARTIAL_PAYMENT',
        partialAmount: 500,
      }),
    ).toBe(500)
  })

  it('prefers recorded payments over partialAmount', () => {
    expect(
      getOrderPaidAmount({
        total: 1500,
        paymentOptionType: 'PARTIAL_PAYMENT',
        partialAmount: 500,
        payments: [{ amount: 700, status: 'PAID' }],
      }),
    ).toBe(700)
  })

  it('handles string amounts from the API', () => {
    expect(
      getOrderPaidAmount({ total: '1500', payments: [{ amount: '500.50', status: 'PAID' }] }),
    ).toBe(500.5)
  })
})

describe('getOrderDueAmount', () => {
  it('returns 0 for a null/undefined order', () => {
    expect(getOrderDueAmount(null)).toBe(0)
  })

  it('returns the full total for cash-on-delivery', () => {
    expect(getOrderDueAmount({ total: 1500, paymentOptionType: 'CASH_ON_DELIVERY' })).toBe(1500)
  })

  it('returns the full total when nothing has been paid', () => {
    expect(getOrderDueAmount({ total: 850 })).toBe(850)
  })

  it('returns 0 for a fully paid order', () => {
    expect(getOrderDueAmount({ total: 1500, paymentStatus: 'PAID' })).toBe(0)
    expect(getOrderDueAmount({ total: 1500, paymentOptionType: 'FULL_PAYMENT' })).toBe(0)
  })

  it('subtracts verified advance payments from the total', () => {
    const order = {
      total: 1500,
      paymentStatus: 'PARTIAL_PAID',
      paymentOptionType: 'PARTIAL_PAYMENT',
      partialAmount: 500,
      payments: [{ status: 'PAID', amount: 500 }],
    }
    expect(getOrderDueAmount(order)).toBe(1000)
  })

  it('never goes negative when payments exceed the total', () => {
    const order = {
      total: 500,
      paymentOptionType: 'PARTIAL_PAYMENT',
      payments: [{ status: 'PAID', amount: 800 }],
    }
    expect(getOrderDueAmount(order)).toBe(0)
  })

  it('guarantees paid + due equals the total for a partial order', () => {
    const order = {
      total: 1500,
      paymentOptionType: 'PARTIAL_PAYMENT',
      partialAmount: 500,
      payments: [{ status: 'PAID', amount: 500 }],
    }
    expect(getOrderPaidAmount(order) + getOrderDueAmount(order)).toBe(order.total)
  })

  it('guarantees paid + due equals the total for cash-on-delivery', () => {
    const order = { total: 2750.5, paymentOptionType: 'CASH_ON_DELIVERY' }
    expect(getOrderPaidAmount(order) + getOrderDueAmount(order)).toBe(order.total)
  })
})
