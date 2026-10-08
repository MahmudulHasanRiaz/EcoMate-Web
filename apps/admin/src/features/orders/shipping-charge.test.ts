import { describe, it, expect } from 'vitest'
import { resolveCityCharge, shouldAutoFillCharge } from './shipping-charge'

const SETTINGS = { delivery_charge: '60', district_charges: JSON.stringify({ Sylhet: 100 }) }
const ZONES = [
  { isActive: true, districts: ['Dhaka'], type: 'custom_amount', amount: 120 },
  { isActive: true, districts: ['Nowhere'], type: 'free_delivery', amount: null },
  { isActive: false, districts: ['Ghost'], type: 'custom_amount', amount: 10 },
]

describe('resolveCityCharge', () => {
  it('uses the matching custom_amount zone (case-insensitive)', () => {
    expect(resolveCityCharge('dhaka', SETTINGS, ZONES)).toBe(120)
  })

  it('maps free_delivery zones to 0', () => {
    expect(resolveCityCharge('Nowhere', SETTINGS, ZONES)).toBe(0)
  })

  it('falls back to the district_charges map when no zone matches', () => {
    expect(resolveCityCharge('Sylhet', SETTINGS, ZONES)).toBe(100)
  })

  it('uses the MAXIMUM configured charge when nothing matches', () => {
    expect(resolveCityCharge('Barisal', SETTINGS, ZONES)).toBe(120)
  })

  it('uses the default when nothing is configured at all', () => {
    expect(resolveCityCharge('Barisal', { delivery_charge: '60' }, [])).toBe(60)
  })

  it('ignores inactive zones', () => {
    expect(resolveCityCharge('Ghost', SETTINGS, ZONES)).toBe(120)
  })

  it('survives a broken district_charges JSON', () => {
    expect(resolveCityCharge('Sylhet', { ...SETTINGS, district_charges: '{oops' }, ZONES)).toBe(120)
  })
})

describe('shouldAutoFillCharge', () => {
  const base = { isPrefilled: false, activeCityId: 'c1', lastAutoCityId: 'c1', manuallyEdited: false }

  it('autofills for a fresh city pick', () => {
    expect(shouldAutoFillCharge({ ...base, lastAutoCityId: null })).toBe(true)
  })

  it('refills when staff picks a DIFFERENT city after a manual edit', () => {
    expect(shouldAutoFillCharge({ ...base, activeCityId: 'c2', manuallyEdited: true })).toBe(true)
  })

  it('keeps a staff-typed rate on background refetch of the same city', () => {
    expect(shouldAutoFillCharge({ ...base, manuallyEdited: true })).toBe(false)
  })

  it('never autofills on edit/exchange forms', () => {
    expect(shouldAutoFillCharge({ ...base, isPrefilled: true })).toBe(false)
  })

  it('never autofills without a city', () => {
    expect(shouldAutoFillCharge({ ...base, activeCityId: '' })).toBe(false)
  })
})
