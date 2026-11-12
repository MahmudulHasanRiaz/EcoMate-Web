import { describe, it, expect } from 'vitest'
import { normalizeSourcePlatforms } from './sales-channel-options'

const SOURCES = [
  { slug: 'facebook', displayName: 'Facebook', enabled: true, capabilities: ['MESSAGING'] },
  { slug: 'whatsapp', displayName: 'WhatsApp', enabled: true, capabilities: ['MESSAGING'] },
]

describe('normalizeSourcePlatforms (order-create 500)', () => {
  // `GET /sales-channel/sources` returns a bare array today, but the create
  // page renders `sourceOptions.map(...)` directly. The old derivation
  // `(messagingSources ?? [])` passed an envelope object straight through —
  // a truthy non-array — and `.map` threw `(oe || []).map is not a function`
  // on the whole page. The boundary must accept either shape.
  it('passes a bare array through', () => {
    expect(normalizeSourcePlatforms(SOURCES)).toEqual(SOURCES)
  })

  it('unwraps a {sources: [...]} envelope', () => {
    expect(normalizeSourcePlatforms({ sources: SOURCES })).toEqual(SOURCES)
  })

  it('unwraps a {data: [...]} envelope', () => {
    expect(normalizeSourcePlatforms({ data: SOURCES })).toEqual(SOURCES)
  })

  it('returns [] for an object with no array in it', () => {
    expect(normalizeSourcePlatforms({ sources: 'nope' })).toEqual([])
    expect(normalizeSourcePlatforms({})).toEqual([])
  })

  it('returns [] for null/undefined/non-object bodies', () => {
    expect(normalizeSourcePlatforms(null)).toEqual([])
    expect(normalizeSourcePlatforms(undefined)).toEqual([])
    expect(normalizeSourcePlatforms('facebook')).toEqual([])
    expect(normalizeSourcePlatforms(42)).toEqual([])
  })

  it('drops entries missing a slug or displayName instead of rendering them', () => {
    expect(
      normalizeSourcePlatforms([
        ...SOURCES,
        { slug: '', displayName: 'NoSlug', enabled: true, capabilities: [] },
        { slug: 'nosuch', displayName: '', enabled: true, capabilities: [] },
      ]),
    ).toEqual(SOURCES)
  })
})
