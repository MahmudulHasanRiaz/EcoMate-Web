import { describe, expect, it } from 'vitest'
import { remainingByOrderItem } from './return-remaining'

const line = (id: string, productId: string, quantity: number, variantId: string | null = null) => ({
  id, productId, variantId, quantity,
})

const ret = (items: { productId: string; variantId?: string | null; quantity: number }[]) => ({ items })

/**
 * Per-line return caps: max = ordered − already-returned (across ACTIVE
 * returns only — the caller filters CLOSED). Mirrors the backend
 * assertReturnEligible overlap rule so the picker never offers a quantity
 * the server would reject with "Only X left to return".
 */
describe('remainingByOrderItem', () => {
  it('returns the full ordered quantity when nothing was returned yet', () => {
    expect(remainingByOrderItem([line('oi-1', 'p1', 2)], [])).toEqual({ 'oi-1': 2 })
  })

  it('subtracts already-returned quantities across active returns', () => {
    const out = remainingByOrderItem(
      [line('oi-1', 'p1', 3)],
      [ret([{ productId: 'p1', quantity: 1 }]), ret([{ productId: 'p1', quantity: 1 }])],
    )
    expect(out).toEqual({ 'oi-1': 1 })
  })

  it('floors at zero when everything was already returned', () => {
    const out = remainingByOrderItem(
      [line('oi-1', 'p1', 2)],
      [ret([{ productId: 'p1', quantity: 5 }])],
    )
    expect(out).toEqual({ 'oi-1': 0 })
  })

  it('scopes by variant: a return of another variant does not consume the cap', () => {
    const out = remainingByOrderItem(
      [line('oi-1', 'p1', 2, 'v1'), line('oi-2', 'p1', 2, 'v2')],
      [ret([{ productId: 'p1', variantId: 'v2', quantity: 2 }])],
    )
    expect(out).toEqual({ 'oi-1': 2, 'oi-2': 0 })
  })

  it('distributes a shared key greedily in line order', () => {
    const out = remainingByOrderItem(
      [line('oi-1', 'p1', 2), line('oi-2', 'p1', 2)],
      [ret([{ productId: 'p1', quantity: 3 }])],
    )
    // 4 ordered − 3 returned = 1 left → first line takes it, second gets 0.
    expect(out).toEqual({ 'oi-1': 1, 'oi-2': 0 })
  })

  it('ignores return rows with an unknown split (empty items never block)', () => {
    const out = remainingByOrderItem([line('oi-1', 'p1', 2)], [ret([])])
    expect(out).toEqual({ 'oi-1': 2 })
  })

  it('ignores item-less lines on the order', () => {
    expect(remainingByOrderItem([], [])).toEqual({})
  })
})
