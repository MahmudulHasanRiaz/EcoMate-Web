import { describe, expect, it } from 'vitest'
import { deriveExchangeType } from './api'

describe('deriveExchangeType (Task 7)', () => {
  const original = [
    { productId: 'p-1', variantId: null, quantity: 2 },
    { productId: 'p-2', variantId: null, quantity: 1 },
  ]

  it('returns Full when the return carries every original line at full quantity', () => {
    expect(
      deriveExchangeType(original, [
        { productId: 'p-1', variantId: null, quantity: 2 },
        { productId: 'p-2', variantId: null, quantity: 1 },
      ]),
    ).toBe('Full')
  })

  it('returns Partial for a subset of lines', () => {
    expect(deriveExchangeType(original, [{ productId: 'p-1', variantId: null, quantity: 2 }])).toBe(
      'Partial',
    )
  })

  it('returns Partial for short quantities', () => {
    expect(
      deriveExchangeType(original, [
        { productId: 'p-1', variantId: null, quantity: 1 },
        { productId: 'p-2', variantId: null, quantity: 1 },
      ]),
    ).toBe('Partial')
  })

  it('returns — when the return leg is unknown (never guessed)', () => {
    expect(deriveExchangeType(original, [])).toBe('—')
    expect(deriveExchangeType(original, null)).toBe('—')
  })
})
