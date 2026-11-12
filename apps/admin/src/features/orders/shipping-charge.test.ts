import { describe, it, expect } from 'vitest'
import { resolveCityCharge, shouldAutoFillCharge, normalizeShippingZones } from './shipping-charge'

const SETTINGS = { delivery_charge: '60', district_charges: JSON.stringify({ Sylhet: 100 }) }
const ZONES = [
  { isActive: true, districts: ['Dhaka'], type: 'custom_amount', amount: 120 },
  { isActive: true, districts: ['Nowhere'], type: 'free_delivery', amount: null },
  { isActive: false, districts: ['Ghost'], type: 'custom_amount', amount: 10 },
]

describe('normalizeShippingZones (order-create 500)', () => {
  // The exact crash shape: the old query did `(r.data as any[]) || []`, so an
  // envelope object passed through as `shippingZones` and `resolveCityCharge`
  // threw `zones.find is not a function` / `for...of` on a non-iterable.
  // `GET /shipping/zones` returns a bare array today, but the boundary must
  // accept either shape so a future envelope can never white-screen the page.
  it('passes a bare array through', () => {
    expect(normalizeShippingZones(ZONES)).toEqual(ZONES)
  })

  it('unwraps a {zones: [...]} envelope', () => {
    expect(normalizeShippingZones({ zones: ZONES })).toEqual(ZONES)
  })

  it('unwraps a {data: [...]} envelope', () => {
    expect(normalizeShippingZones({ data: ZONES })).toEqual(ZONES)
  })

  it('returns [] for an object with no array in it', () => {
    expect(normalizeShippingZones({ zones: 'nope' })).toEqual([])
    expect(normalizeShippingZones({})).toEqual([])
  })

  it('returns [] for null/undefined/non-object bodies', () => {
    expect(normalizeShippingZones(null)).toEqual([])
    expect(normalizeShippingZones(undefined)).toEqual([])
    expect(normalizeShippingZones('Dhaka')).toEqual([])
    expect(normalizeShippingZones(42)).toEqual([])
  })
})

describe('resolveCityCharge', () => {
  it('uses the matching custom_amount zone (case-insensitive)', () => {
    expect(resolveCityCharge('dhaka', SETTINGS, ZONES)).toBe(120)
  })

  it('survives a non-array shippingZones value instead of throwing', () => {
    // The envelope object fed straight in (old query shape): must fall back
    // to the default/max charge, never throw. (With no zone list the max is
    // the district map's 100, not the zone's 120.)
    expect(resolveCityCharge('Barisal', SETTINGS, { zones: ZONES } as any)).toBe(100)
    expect(resolveCityCharge('Barisal', { delivery_charge: '60' }, {} as any)).toBe(60)
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
