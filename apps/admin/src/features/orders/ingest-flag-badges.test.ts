import { describe, expect, it } from 'vitest'
import { FLAG_COPY } from './ingest-flag-badges'

/**
 * P6 ingest-flag badge copy (BR-15): informational only — badge text must
 * never imply the order was rejected, at risk, or blocked from transitioning.
 */
describe('ingest flag badges', () => {
  it('covers every ingest flag the backend can write', () => {
    for (const flag of ['BLOCKED_PHONE', 'BLOCKED_IP', 'SUSPENDED_CUSTOMER', 'STOCK_SHORTFALL', 'UNMATCHED_SKU']) {
      expect(FLAG_COPY[flag]?.label).toBeTruthy()
      expect(FLAG_COPY[flag]?.hint).toBeTruthy()
    }
  })

  it('copy never implies rejection', () => {
    const all = Object.values(FLAG_COPY).map((c) => `${c.label} ${c.hint}`.toLowerCase()).join(' | ')
    expect(all).not.toContain('reject')
    expect(all).not.toContain('at risk')
    expect(all).not.toContain('blocked this order')
  })
})
