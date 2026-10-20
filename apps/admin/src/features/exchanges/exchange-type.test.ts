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

  // The shared order-detail payload types productId loosely (manual/legacy
  // lines can lack it). The derivation must accept the loose shape without
  // type assertions and stay identical for the matchable lines.
  it('skips original lines without a productId and stays Full for the matchable ones', () => {
    expect(
      deriveExchangeType(
        [
          { productId: null, variantId: null, quantity: 1 },
          { productId: 'p-1', variantId: null, quantity: 2 },
          { productId: undefined, variantId: null, quantity: 3 },
          { productId: 'p-2', variantId: null, quantity: 1 },
        ],
        [
          { productId: 'p-1', variantId: null, quantity: 2 },
          { productId: 'p-2', variantId: null, quantity: 1 },
        ],
      ),
    ).toBe('Full')
  })

  it('never claims Full when a return line has no productId (cannot be matched)', () => {
    expect(
      deriveExchangeType(original, [
        { productId: 'p-1', variantId: null, quantity: 2 },
        { productId: 'p-2', variantId: null, quantity: 1 },
        { productId: null, variantId: null, quantity: 1 },
      ]),
    ).toBe('Partial')
  })

  it('coerces loose quantity values from the section payload', () => {
    expect(
      deriveExchangeType(
        [{ productId: 'p-1', variantId: null, quantity: '2' }],
        [{ productId: 'p-1', variantId: null, quantity: '2' }],
      ),
    ).toBe('Full')
  })
})
