import { describe, expect, it } from 'vitest'
import { formatCurrency } from './utils'

describe('dashboard formatCurrency (D19)', () => {
  it('renders the ৳ glyph, not the BDT code', () => {
    expect(formatCurrency(500)).toBe('৳500')
    expect(formatCurrency(0)).toBe('৳0')
  })
})
