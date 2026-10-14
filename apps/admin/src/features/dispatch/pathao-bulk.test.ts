import { describe, it, expect } from 'vitest'
import {
  isPathaoBulkAccepted,
  formatPathaoBulkToast,
  PATHAO_BULK_DISPATCH_LIST_PATH,
} from './pathao-bulk'

describe('Task 9(a) Pathao bulk UI', () => {
  it('treats {accepted:true} as accepted (async), not created', () => {
    expect(
      isPathaoBulkAccepted({ accepted: true, count: 2, results: [] }),
    ).toBe(true)
  })

  it('toast says "accepted — results arrive automatically; check dispatch list" — never "created", "dispatched" or a fake order-info verify', () => {
    const text = formatPathaoBulkToast({
      accepted: true,
      count: 2,
      results: [
        { id: 'a', merchant_order_id: 'ORD-1', ok: true, accepted: true, message: 'accepted, processing' },
        { id: 'b', merchant_order_id: 'ORD-2', ok: true, accepted: true, message: 'accepted, processing' },
      ],
    })
    expect(text).toMatch(/accepted/i)
    expect(text).toMatch(/results arrive automatically/i)
    expect(text).toMatch(/dispatch list/i)
    expect(text).not.toMatch(/created/i)
    expect(text).not.toMatch(/dispatched/i)
    expect(text).not.toMatch(/verify via order info/i)
  })

  it('toast names the actionable merchant handles (displayIds), never internal ids alone', () => {
    const text = formatPathaoBulkToast({
      accepted: true,
      count: 2,
      results: [
        { id: 'internal-1', merchant_order_id: 'ORD-1', ok: true, accepted: true, message: 'accepted, processing' },
        { id: 'internal-2', merchant_order_id: 'ORD-2', ok: true, accepted: true, message: 'accepted, processing' },
      ],
    })
    expect(text).toContain('ORD-1')
    expect(text).toContain('ORD-2')
    expect(text).not.toContain('internal-1')
    expect(text).not.toContain('internal-2')
  })

  it('exposes the dispatch-list link for the toast action', () => {
    expect(PATHAO_BULK_DISPATCH_LIST_PATH).toBe('/op/dispatch')
  })

  it('non-accepted body is not accepted', () => {
    expect(isPathaoBulkAccepted({ accepted: false })).toBe(false)
    expect(isPathaoBulkAccepted(null)).toBe(false)
  })
})
