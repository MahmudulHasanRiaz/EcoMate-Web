import { describe, it, expect } from 'vitest'
import { isRedxChargePreview, formatRedxChargePreview } from './redx-charge'

describe('Task 9(c) RedX charge preview UI', () => {
  it('treats {deliveryCharge, codCharge} numbers as a valid preview', () => {
    expect(isRedxChargePreview({ deliveryCharge: 60, codCharge: 0 })).toBe(true)
  })

  it('preview text shows both charges + preview note — never blocks dispatch', () => {
    const text = formatRedxChargePreview({ deliveryCharge: 60, codCharge: 12 })
    expect(text).toMatch(/60/)
    expect(text).toMatch(/12/)
    expect(text).toMatch(/preview/i)
    expect(text).toMatch(/not blocked|non-blocking/i)
    expect(text).not.toMatch(/required/i)
    expect(text).not.toMatch(/fail/i)
  })

  it('non-preview body is not a preview', () => {
    expect(isRedxChargePreview(null)).toBe(false)
    expect(isRedxChargePreview({})).toBe(false)
    expect(isRedxChargePreview({ deliveryCharge: 60 })).toBe(false)
  })
})
