import { describe, expect, it } from 'vitest'
import {
  LEGACY_RETURN_STAGING_KEY,
  STAGED_RETURNS_KEY,
  editStagedLine,
  loadStagedReturns,
  persistStagedReturns,
  sanitizeStagedReturns,
  type StagedReturn,
  type StagedReturnLine,
} from './staged-returns'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

const asStorage = (s: MemoryStorage) => s as unknown as Storage

const baseRow = (over: Partial<StagedReturn> = {}): StagedReturn => ({
  key: 'ret-1',
  purpose: 'RETURN_RECEIVE',
  identifier: 'ORD-1',
  kind: 'return',
  legId: 'ret-1',
  orderId: 'o1',
  displayId: 'RTN-1',
  orderDisplayId: 'ORD-1',
  status: 'REQUESTED',
  processable: true,
  reason: null,
  customerName: 'Md. Rahim',
  customerPhone: '01700000001',
  items: [],
  ...over,
})

const line = (over: Partial<StagedReturnLine> = {}): StagedReturnLine => ({
  productId: 'p-1',
  variantId: null,
  name: 'Hoodie',
  quantity: 3,
  maxQuantity: 3,
  damagedQuantity: 0,
  ...over,
})

describe('unified staged returns storage', () => {
  it('merges the legacy RETURN_RECEIVE key exactly once and retires it', () => {
    const storage = new MemoryStorage()
    const legacy = baseRow({
      purpose: undefined as unknown as StagedReturn['purpose'],
      key: 'ret-legacy',
      displayId: 'RTN-OLD',
      items: [{ name: 'Old line', quantity: 1 } as any],
    })
    storage.setItem(LEGACY_RETURN_STAGING_KEY, JSON.stringify([legacy]))

    const first = loadStagedReturns(asStorage(storage))
    expect(first).toHaveLength(1)
    expect(first[0].purpose).toBe('RETURN_RECEIVE')
    expect(storage.getItem(LEGACY_RETURN_STAGING_KEY)).toBeNull()
    expect(JSON.parse(storage.getItem(STAGED_RETURNS_KEY) ?? '[]')).toHaveLength(1)

    // A second load never re-reads or duplicates the retired key.
    const second = loadStagedReturns(asStorage(storage))
    expect(second).toHaveLength(1)
  })

  it('keeps the NEW key row when the same key exists in both lists', () => {
    const storage = new MemoryStorage()
    storage.setItem(STAGED_RETURNS_KEY, JSON.stringify([baseRow({ displayId: 'RTN-NEW' })]))
    storage.setItem(LEGACY_RETURN_STAGING_KEY, JSON.stringify([baseRow({ displayId: 'RTN-OLD' })]))
    const rows = loadStagedReturns(asStorage(storage))
    expect(rows).toHaveLength(1)
    expect(rows[0].displayId).toBe('RTN-NEW')
  })

  it('persists both purposes and caps the list at 200', () => {
    const storage = new MemoryStorage()
    const rows = Array.from({ length: 205 }, (_, i) =>
      baseRow({
        key: `row-${i}`,
        purpose: i % 2 === 0 ? 'RETURN_RECEIVE' : 'DISPATCH_RETURN',
        kind: i % 2 === 0 ? 'return' : 'dispatch',
      }),
    )
    persistStagedReturns(asStorage(storage), rows)
    const restored = loadStagedReturns(asStorage(storage))
    expect(restored).toHaveLength(200)
    expect(new Set(restored.map((r) => r.purpose))).toEqual(
      new Set(['RETURN_RECEIVE', 'DISPATCH_RETURN']),
    )
  })

  it('sanitizes malformed payloads without throwing', () => {
    expect(sanitizeStagedReturns('nope')).toEqual([])
    expect(sanitizeStagedReturns([null, { key: 1 }, { key: 'k', displayId: 'D' }])).toHaveLength(1)
  })
})

describe('staged line damage clamping', () => {
  it('never lets damage exceed the received quantity', () => {
    const next = editStagedLine(line(), { damagedQuantity: 99 })
    expect(next.damagedQuantity).toBe(3)
  })

  it('clamps received quantity to the line max and existing damage down with it', () => {
    const withDamage = line({ damagedQuantity: 3 })
    const next = editStagedLine(withDamage, { quantity: 1 })
    expect(next.quantity).toBe(1)
    expect(next.damagedQuantity).toBe(1)
  })

  it('never lets received quantity go below zero', () => {
    expect(editStagedLine(line(), { quantity: -5 }).quantity).toBe(0)
  })
})
