import { describe, it, expect } from 'vitest'
import {
  DISABLE_ALL_CONFIRM_TEXT,
  availabilitySourceLabel,
  flattenCategories,
  isDisableConfirmValid,
  type StoreAvailabilityRow,
} from './distribution-api'

const row = (overrides: Partial<StoreAvailabilityRow>): StoreAvailabilityRow => ({
  storeId: 's1',
  kind: 'WOOCOMMERCE',
  name: 'Woo',
  overrideAvailable: null,
  ruleAvailable: null,
  effective: false,
  ...overrides,
})

describe('distribution API helpers (P3)', () => {
  describe('availabilitySourceLabel', () => {
    it('names the deciding §8.2 layer: override ?? rule ?? default', () => {
      expect(availabilitySourceLabel(row({ overrideAvailable: true, ruleAvailable: false }))).toBe('Manual override')
      expect(availabilitySourceLabel(row({ overrideAvailable: null, ruleAvailable: true }))).toBe('Category rule')
      expect(availabilitySourceLabel(row({}))).toBe('Default off')
    })

    it('marks NATIVE rows as global-only (BR-20)', () => {
      expect(availabilitySourceLabel(row({ kind: 'NATIVE', overrideAvailable: false }))).toBe('Native (global only)')
    })
  })

  describe('disable-all typed confirmation', () => {
    it('accepts only the exact DISABLE text', () => {
      expect(DISABLE_ALL_CONFIRM_TEXT).toBe('DISABLE')
      expect(isDisableConfirmValid('DISABLE')).toBe(true)
      expect(isDisableConfirmValid('disable')).toBe(false)
      expect(isDisableConfirmValid('DISABLE ')).toBe(false)
      expect(isDisableConfirmValid('')).toBe(false)
    })
  })

  describe('flattenCategories', () => {
    it('flattens pre-order with depth', () => {
      const flat = flattenCategories([
        { id: 'a', name: 'A', children: [{ id: 'b', name: 'B', children: [{ id: 'c', name: 'C' }] }] },
        { id: 'd', name: 'D' },
      ])
      expect(flat).toEqual([
        { id: 'a', label: 'A', depth: 0 },
        { id: 'b', label: 'B', depth: 1 },
        { id: 'c', label: 'C', depth: 2 },
        { id: 'd', label: 'D', depth: 0 },
      ])
    })

    it('tolerates missing children', () => {
      expect(flattenCategories([])).toEqual([])
      expect(flattenCategories([{ id: 'x', name: 'X' }])).toEqual([{ id: 'x', label: 'X', depth: 0 }])
    })
  })
})
