import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeCourierCities,
  normalizeCourierZones,
  readLastGoodCities,
  readLastGoodEntry,
  COURIER_CITIES_LAST_GOOD_KEY,
} from './use-courier-cities'

describe('normalizeCourierCities (finding 2)', () => {
  it('passes the current envelope through', () => {
    expect(
      normalizeCourierCities({
        cities: [
          { id: 1, name: 'Dhaka' },
          { id: 2, name: 'Chattogram' },
        ],
        courierConfigured: true,
        source: 'pathao',
      }),
    ).toEqual({
      cities: [
        { id: 1, name: 'Dhaka' },
        { id: 2, name: 'Chattogram' },
      ],
      courierConfigured: true,
      source: 'pathao',
    })
  })

  it('maps the no-courier envelope to an empty list with courierConfigured:false', () => {
    expect(
      normalizeCourierCities({ cities: [], courierConfigured: false, source: null }),
    ).toEqual({ cities: [], courierConfigured: false, source: null })
  })

  it('still accepts the legacy bare-array body (backend deploy lag)', () => {
    expect(normalizeCourierCities([{ id: 1, name: 'Dhaka' }])).toEqual({
      cities: [{ id: 1, name: 'Dhaka' }],
      courierConfigured: true,
      source: null,
    })
  })

  it('drops courier entries with a missing id or name instead of rendering them', () => {
    expect(
      normalizeCourierCities({
        cities: [
          { id: 1, name: 'Dhaka' },
          { id: 2, name: null },
          { id: null, name: 'NoId' },
        ],
        courierConfigured: true,
        source: 'pathao',
      }),
    ).toEqual({
      cities: [{ id: 1, name: 'Dhaka' }],
      courierConfigured: true,
      source: 'pathao',
    })
  })

  it('treats a null/undefined body as no-courier, not a crash', () => {
    expect(normalizeCourierCities(null)).toEqual({
      cities: [],
      courierConfigured: false,
      source: null,
    })
  })

  it('unwraps the { data: [...] } envelope (P0 round: was degraded to [])', () => {
    expect(
      normalizeCourierCities({
        data: [
          { id: 1, name: 'Dhaka' },
          { id: 2, name: 'Chattogram' },
        ],
      }),
    ).toEqual({
      cities: [
        { id: 1, name: 'Dhaka' },
        { id: 2, name: 'Chattogram' },
      ],
      courierConfigured: true,
      source: null,
    })
  })

  it('prefers cities over data when both are present', () => {
    expect(
      normalizeCourierCities({
        cities: [{ id: 1, name: 'Dhaka' }],
        data: [{ id: 2, name: 'Chattogram' }],
        courierConfigured: true,
        source: 'pathao',
      }),
    ).toEqual({
      cities: [{ id: 1, name: 'Dhaka' }],
      courierConfigured: true,
      source: 'pathao',
    })
  })
})

describe('normalizeCourierZones (finding 2)', () => {
  it('passes the current envelope through', () => {
    expect(
      normalizeCourierZones({
        zones: [
          { id: 1, name: 'Banani' },
          { id: 2, name: 'Uttara' },
        ],
      }),
    ).toEqual([
      { id: 1, name: 'Banani' },
      { id: 2, name: 'Uttara' },
    ])
  })

  it('still accepts the legacy bare-array body', () => {
    expect(normalizeCourierZones([{ id: 1, name: 'Banani' }])).toEqual([
      { id: 1, name: 'Banani' },
    ])
  })

  it('unwraps the { data: [...] } envelope (P0 round: was degraded to [])', () => {
    expect(
      normalizeCourierZones({
        data: [
          { id: 1, name: 'Banani' },
          { id: 2, name: 'Uttara' },
        ],
      }),
    ).toEqual([
      { id: 1, name: 'Banani' },
      { id: 2, name: 'Uttara' },
    ])
  })

  it('prefers zones over data when both are present', () => {
    expect(
      normalizeCourierZones({
        zones: [{ id: 1, name: 'Banani' }],
        data: [{ id: 2, name: 'Uttara' }],
      }),
    ).toEqual([{ id: 1, name: 'Banani' }])
  })
})

describe.skipIf(typeof localStorage === 'undefined')(
  'readLastGoodCities (finding 2)',
  () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns undefined when nothing was persisted', () => {
    expect(readLastGoodCities()).toBeUndefined()
  })

  it('returns the persisted list', () => {
    localStorage.setItem(
      COURIER_CITIES_LAST_GOOD_KEY,
      JSON.stringify({
        cities: [{ id: 1, name: 'Dhaka' }],
        courierConfigured: true,
        source: 'pathao',
      }),
    )
    expect(readLastGoodCities()).toEqual({
      cities: [{ id: 1, name: 'Dhaka' }],
      courierConfigured: true,
      source: 'pathao',
    })
  })

  it('ignores a persisted empty list and corrupt JSON', () => {
    localStorage.setItem(
      COURIER_CITIES_LAST_GOOD_KEY,
      JSON.stringify({ cities: [], courierConfigured: true, source: 'pathao' }),
    )
    expect(readLastGoodCities()).toBeUndefined()
    localStorage.setItem(COURIER_CITIES_LAST_GOOD_KEY, '{not json')
    expect(readLastGoodCities()).toBeUndefined()
  })

  it('readLastGoodEntry returns the persisted timestamp (drives stale-while-revalidate)', () => {
    localStorage.setItem(
      COURIER_CITIES_LAST_GOOD_KEY,
      JSON.stringify({
        cities: [{ id: 1, name: 'Dhaka' }],
        courierConfigured: true,
        source: 'pathao',
        updatedAt: 12345,
      }),
    )
    expect(readLastGoodEntry()).toEqual({
      data: {
        cities: [{ id: 1, name: 'Dhaka' }],
        courierConfigured: true,
        source: 'pathao',
      },
      updatedAt: 12345,
    })
  })
})
