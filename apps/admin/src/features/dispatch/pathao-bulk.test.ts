import { describe, it, expect } from 'vitest'
import { isPathaoBulkAccepted, formatPathaoBulkToast } from './pathao-bulk'

describe('Task 9(a) Pathao bulk UI', () => {
  it('treats {accepted:true} as accepted (async), not created', () => {
    expect(
      isPathaoBulkAccepted({ accepted: true, count: 2, results: [] }),
    ).toBe(true)
  })

  it('toast says "accepted, processing" — never "created" or "dispatched"', () => {
    const text = formatPathaoBulkToast({
      accepted: true,
      count: 2,
      results: [
        { id: 'a', ok: true, accepted: true, message: 'accepted, processing' },
      ],
    })
    expect(text).toMatch(/accepted, processing/i)
    expect(text).not.toMatch(/created/i)
    expect(text).not.toMatch(/dispatched/i)
  })

  it('non-accepted body is not accepted', () => {
    expect(isPathaoBulkAccepted({ accepted: false })).toBe(false)
    expect(isPathaoBulkAccepted(null)).toBe(false)
  })
})
