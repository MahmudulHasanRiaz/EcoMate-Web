import { describe, expect, it, vi } from 'vitest'
import {
  createMismatchToastGate,
  extractOrderReference,
  isOrderReference,
  routePackingScan,
} from './packing-scan'

/**
 * Packing scan boundary — the order step vs the item step.
 *
 * Production incident (2026-10-21): the order QR kept being decoded on the
 * ITEM screen and raised a "Wrong Product!" toast ~10x per second.
 */
describe('extractOrderReference', () => {
  it('reads the order id out of a storefront order URL', () => {
    expect(extractOrderReference('https://www.avelto.bd/orders/ORD-261021-0023')).toBe('ORD-261021-0023')
    expect(extractOrderReference('https://ecomate.com/orders/ORD-260101-0001?id=ORD-260101-0002')).toBe('ORD-260101-0002')
  })

  it('reads a plain order/return id', () => {
    expect(extractOrderReference('ORD-261021-0023')).toBe('ORD-261021-0023')
    expect(extractOrderReference('rtn-261021-0023')).toBe('RTN-261021-0023')
  })

  it('is NOT an order reference for a product SKU', () => {
    expect(extractOrderReference('SKU-BLU-M')).toBeNull()
    expect(isOrderReference('SKU-BLU-M')).toBe(false)
    expect(isOrderReference('https://www.avelto.bd/orders/ORD-261021-0023')).toBe(true)
  })
})

describe('routePackingScan', () => {
  it('sends an order value to the ORDER step (extracting the id from a URL)', () => {
    const onOrder = vi.fn()
    const onProduct = vi.fn()
    routePackingScan('https://www.avelto.bd/orders/ORD-261021-0023', {
      orderOpen: false,
      onOrder,
      onProduct,
    })
    expect(onOrder).toHaveBeenCalledWith('ORD-261021-0023')
    expect(onProduct).not.toHaveBeenCalled()
  })

  it('sends a product value to the ITEM step when an order is open', () => {
    const onOrder = vi.fn()
    const onProduct = vi.fn()
    routePackingScan('SKU-BLU-M', { orderOpen: true, onOrder, onProduct })
    expect(onProduct).toHaveBeenCalledWith('SKU-BLU-M')
    expect(onOrder).not.toHaveBeenCalled()
  })

  it('IGNORES an order reference that leaks into the item step (never a wrong-SKU error)', () => {
    const onOrder = vi.fn()
    const onProduct = vi.fn()
    routePackingScan('https://www.avelto.bd/orders/ORD-261021-0023', {
      orderOpen: true,
      onOrder,
      onProduct,
    })
    expect(onProduct).not.toHaveBeenCalled()
    expect(onOrder).not.toHaveBeenCalled()
  })
})

describe('createMismatchToastGate', () => {
  it('lets the same wrong value toast once per window, and a different value always', () => {
    const gate = createMismatchToastGate(4000)
    expect(gate.shouldToast('WRONG-1', 1000)).toBe(true)
    expect(gate.shouldToast('WRONG-1', 1500)).toBe(false)
    expect(gate.shouldToast('WRONG-1', 3000)).toBe(false)
    expect(gate.shouldToast('WRONG-2', 3100)).toBe(true)
    // The window elapsed → the same value may toast again.
    expect(gate.shouldToast('WRONG-1', 9000)).toBe(true)
  })

  it('resets for a new arm cycle', () => {
    const gate = createMismatchToastGate(4000)
    expect(gate.shouldToast('WRONG-1', 1000)).toBe(true)
    expect(gate.shouldToast('WRONG-1', 1200)).toBe(false)
    gate.reset()
    expect(gate.shouldToast('WRONG-1', 1300)).toBe(true)
  })
})
