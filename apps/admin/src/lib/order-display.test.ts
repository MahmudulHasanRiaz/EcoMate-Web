import { describe, it, expect } from 'vitest'
import { getCustomerDisplayName, getCustomerPhone, getCustomerEmail, getOrderPaidAmount, getOrderDueAmount, getOrderPaymentMode, getPaymentModeForAmounts, hasOpenCodAlert } from './order-display'

describe('customer snapshot authority (D-A)', () => {
  it('display name prefers snapshot over profile', () => {
    const order = { customerFirstName: 'MR', customerLastName: 'Joy', customer: { name: 'OLD' } }
    expect(getCustomerDisplayName(order)).toBe('MR Joy')
  })

  it('phone prefers snapshot over profile', () => {
    const order = { customerPhone: '01711111111', guestPhone: '01822222222', customer: { phone: 'OLD' } }
    expect(getCustomerPhone(order)).toBe('01711111111')
  })

  it('email prefers snapshot over profile', () => {
    const order = { customerEmail: 'new@example.com', customer: { email: 'old@example.com' } }
    expect(getCustomerEmail(order)).toBe('new@example.com')
  })

  it('falls back to guest columns when snapshot names are absent', () => {
    const order = { guestName: 'Walk In', customer: { name: 'OLD' } }
    expect(getCustomerDisplayName(order)).toBe('Walk In')
  })

  it('falls back to profile only when snapshot and guest are absent', () => {
    const order = { customer: { name: 'OLD', phone: '01900000000', email: 'old@example.com' } }
    expect(getCustomerDisplayName(order)).toBe('OLD')
    expect(getCustomerPhone(order)).toBe('01900000000')
    expect(getCustomerEmail(order)).toBe('old@example.com')
  })

  it('reads the phoneNumber profile shape (OrderResponse.customer)', () => {
    const order = { customer: { phoneNumber: '01900000000' } }
    expect(getCustomerPhone(order)).toBe('01900000000')
  })

  it('prefill order: guest phone beats profile phone (snapshot > guest > profile)', () => {
    const order = { guestPhone: '01822222222', customer: { phone: '01900000000', phoneNumber: '01900000000' } }
    expect(getCustomerPhone(order)).toBe('01822222222')
  })
})

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

  it('returns 0 for a FULL_PAYMENT order with no recorded payments (Pay Later)', () => {
    expect(
      getOrderPaidAmount({ total: 1500, paymentOptionType: 'FULL_PAYMENT' }),
    ).toBe(0)
  })

  it('returns 0 for a partial order with no recorded payments (Pay Later)', () => {
    expect(
      getOrderPaidAmount({
        total: 1500,
        paymentOptionType: 'PARTIAL_PAYMENT',
        partialAmount: 500,
      }),
    ).toBe(0)
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
  })

  it('returns the full total for a FULL_PAYMENT order with no recorded payments (Pay Later)', () => {
    expect(getOrderDueAmount({ total: 1500, paymentOptionType: 'FULL_PAYMENT' })).toBe(1500)
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

  it('guarantees paid + due equals the total for a row-less FULL Pay Later order with server due', () => {
    const order = { total: 420, paymentOptionType: 'FULL_PAYMENT', due: 420 }
    expect(getOrderPaidAmount(order)).toBe(0)
    expect(getOrderDueAmount(order)).toBe(420)
    expect(getOrderPaidAmount(order) + getOrderDueAmount(order)).toBe(order.total)
  })

  it('prefers the server-derived due when the API provides it', () => {
    const order = {
      total: 1000,
      due: 300,
      payments: [{ status: 'PAID', amount: 400 }],
      receivedReturnValue: 300,
    }
    expect(getOrderDueAmount(order)).toBe(300)
  })

  it('subtracts received returns from the local fallback', () => {
    const order = {
      total: 1000,
      receivedReturnValue: 300,
      payments: [{ status: 'PAID', amount: 400 }],
    }
    expect(getOrderDueAmount(order)).toBe(300)
    expect(getOrderPaidAmount(order)).toBe(400)
  })

  it('subtracts applied credit and ignores settlement rows', () => {
    const order = {
      total: 1000,
      payments: [
        { status: 'PAID', amount: 300, appliedCreditAmount: 200 },
        { status: 'PAID', amount: 500, gatewayCode: 'courier_settlement' },
      ],
    }
    expect(getOrderPaidAmount(order)).toBe(300)
    expect(getOrderDueAmount(order)).toBe(500)
  })
})

describe('getPaymentModeForAmounts', () => {
  it('returns Unpaid when nothing paid', () => {
    expect(getPaymentModeForAmounts(1000, 0)).toBe('Unpaid')
  })

  it('returns Partial for 0 < paid < total', () => {
    expect(getPaymentModeForAmounts(1000, 400)).toBe('Partial')
  })

  it('returns Paid on the exact boundary paid == total', () => {
    expect(getPaymentModeForAmounts(1000, 1000)).toBe('Paid')
  })

  it('returns Credit when paid exceeds total by a paisa', () => {
    expect(getPaymentModeForAmounts(1000, 1000.01)).toBe('Credit')
  })

  it('treats non-positive paid as Unpaid', () => {
    expect(getPaymentModeForAmounts(1000, -50)).toBe('Unpaid')
  })

  it('coerces string-Decimal inputs', () => {
    expect(getPaymentModeForAmounts('1000', '1000')).toBe('Paid')
    expect(getPaymentModeForAmounts('1000', '1200.50')).toBe('Credit')
  })
})

describe('getOrderPaymentMode', () => {
  it('derives Unpaid for a COD order with no payments', () => {
    expect(getOrderPaymentMode({ total: 1500, paymentOptionType: 'CASH_ON_DELIVERY' })).toBe('Unpaid')
  })

  it('derives Partial from the payment ledger', () => {
    expect(
      getOrderPaymentMode({ total: 1000, payments: [{ amount: 400, status: 'PAID' }] }),
    ).toBe('Partial')
  })

  it('derives Paid when the ledger covers the total', () => {
    expect(
      getOrderPaymentMode({ total: 1000, payments: [{ amount: 1000, status: 'PAID' }] }),
    ).toBe('Paid')
  })

  it('derives Credit on overpayment (Credit overrides Paid)', () => {
    expect(
      getOrderPaymentMode({ total: 1000, payments: [{ amount: 1200, status: 'PAID' }] }),
    ).toBe('Credit')
  })

  it('ignores pending rows and coerces string-Decimal amounts', () => {
    expect(
      getOrderPaymentMode({
        total: '1620',
        payments: [
          { amount: '1500', status: 'PAID' },
          { amount: '999', status: 'PENDING' },
        ],
      }),
    ).toBe('Partial')
  })

  it('treats a fully refunded ledger as Unpaid, not Paid', () => {
    expect(
      getOrderPaymentMode({
        total: 1000,
        payments: [
          { amount: 1000, status: 'PAID' },
          { amount: -1000, status: 'PAID' },
        ],
      }),
    ).toBe('Unpaid')
  })
})

describe('cancelled orders (truthful display)', () => {
  it('cancelled + full refund → mode Refunded + due 0', () => {
    const order = {
      total: 1000,
      status: { name: 'Cancelled' },
      payments: [
        { amount: 1000, status: 'PAID' },
        { amount: -1000, status: 'PAID' },
      ],
    }
    expect(getOrderPaymentMode(order)).toBe('Refunded')
    expect(getOrderDueAmount(order)).toBe(0)
  })

  it('cancelled without payments/refunds → Unpaid + due 0', () => {
    const order = { total: 1000, status: { name: 'Cancelled' } }
    expect(getOrderPaymentMode(order)).toBe('Unpaid')
    expect(getOrderDueAmount(order)).toBe(0)
  })

  it('cancelled + partial refund → due 0 (nothing collectable post-cancel)', () => {
    const order = {
      total: 1000,
      status: { name: 'Cancelled' },
      payments: [
        { amount: 1000, status: 'PAID' },
        { amount: -400, status: 'PAID' },
      ],
    }
    expect(getOrderDueAmount(order)).toBe(0)
  })

  it('non-cancelled full refund stays Unpaid (unchanged)', () => {
    const order = {
      total: 1000,
      payments: [
        { amount: 1000, status: 'PAID' },
        { amount: -1000, status: 'PAID' },
      ],
    }
    expect(getOrderPaymentMode(order)).toBe('Unpaid')
    expect(getOrderDueAmount(order)).toBe(1000)
  })
})

describe('due examples (D6)', () => {
  it('1620 − 1500 = 120', () => {
    expect(
      getOrderDueAmount({ total: 1620, payments: [{ amount: 1500, status: 'PAID' }] }),
    ).toBe(120)
  })

  it('overpayment clamps due to 0', () => {
    expect(
      getOrderDueAmount({ total: 1000, payments: [{ amount: 1200, status: 'PAID' }] }),
    ).toBe(0)
  })

  it('handles string-Decimal amounts', () => {
    expect(
      getOrderDueAmount({ total: '1620', payments: [{ amount: '1500.50', status: 'PAID' }] }),
    ).toBeCloseTo(119.5, 2)
  })

  it('ledger is truth over a stale stored PAID status', () => {
    expect(
      getOrderDueAmount({
        total: 1500,
        paymentStatus: 'PAID',
        payments: [{ amount: 500, status: 'PAID' }],
      }),
    ).toBe(1000)
  })
})

describe('hasOpenCodAlert (derived list badge)', () => {
  it('flags a live dispatch whose courier amount differs from the due', () => {
    expect(
      hasOpenCodAlert({
        total: 1500,
        payments: [{ amount: 1380, status: 'PAID' }], // due 120
        dispatches: [{ consignmentId: 'C1', courierAmount: 1370, status: 'DISPATCHED' }],
      }),
    ).toBe(true)
  })

  it('is quiet when courier amount equals the due', () => {
    expect(
      hasOpenCodAlert({
        total: 1500,
        payments: [{ amount: 1380, status: 'PAID' }],
        dispatches: [{ consignmentId: 'C1', courierAmount: 120, status: 'DISPATCHED' }],
      }),
    ).toBe(false)
  })

  it('ignores cancelled dispatches and missing courier amounts', () => {
    expect(
      hasOpenCodAlert({
        total: 1500,
        dispatches: [{ consignmentId: 'C1', courierAmount: 9999, status: 'CANCELLED' }],
      }),
    ).toBe(false)
    expect(
      hasOpenCodAlert({
        total: 1500,
        dispatches: [{ consignmentId: 'C1', courierAmount: null, status: 'DISPATCHED' }],
      }),
    ).toBe(false)
  })

  it('is quiet without dispatches', () => {
    expect(hasOpenCodAlert({ total: 1500 })).toBe(false)
    expect(hasOpenCodAlert(null)).toBe(false)
  })
})
