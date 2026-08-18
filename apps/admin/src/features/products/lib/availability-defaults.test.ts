import { describe, it, expect } from 'vitest'
import { defaultAvailabilityMode } from './availability-defaults'

const base = {
  type: 'simple',
  userTouched: false,
  hasExistingRow: false,
  hasDraft: false,
}

describe('defaultAvailabilityMode — global Inventory Management setting', () => {
  it('IM enabled → new simple product defaults to INVENTORY_CONTROLLED', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: true })).toBe('INVENTORY_CONTROLLED')
  })

  it('IM disabled → new simple product defaults to MANAGED_STOCK', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: false })).toBe('MANAGED_STOCK')
  })

  it('returns undefined while the setting is still loading (no premature default)', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: undefined })).toBeUndefined()
  })

  it('user override wins: enabled → user picks MANAGED_STOCK', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: true, userTouched: true })).toBeUndefined()
  })

  it('user override wins: disabled → user picks INVENTORY_CONTROLLED', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: false, userTouched: true })).toBeUndefined()
  })

  it('editing an existing product never re-defaults (stored mode wins)', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: true, hasExistingRow: true })).toBeUndefined()
    expect(defaultAvailabilityMode({ ...base, imEnabled: false, hasExistingRow: true })).toBeUndefined()
  })

  it('restored draft never re-defaults (draft mode wins)', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: true, hasDraft: true })).toBeUndefined()
  })

  it('variable products always default to MANAGED_STOCK regardless of IM', () => {
    expect(defaultAvailabilityMode({ ...base, imEnabled: true, type: 'variable' })).toBe('MANAGED_STOCK')
    expect(defaultAvailabilityMode({ ...base, imEnabled: false, type: 'variable' })).toBe('MANAGED_STOCK')
  })
})
