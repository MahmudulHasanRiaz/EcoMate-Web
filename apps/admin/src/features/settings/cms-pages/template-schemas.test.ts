import { describe, it, expect } from 'vitest'
import { templatePageSchemas } from './template-schemas'

const EXPECTED_KEYS = [
  'careers',
  'about',
  'company',
  'faq',
  'contact',
  'stores',
  'delivery-areas',
  'terms-conditions',
  'privacy-policy',
  'refund-policy',
  'exchange-policy',
  'shipping-policy',
  'download',
]

describe('templatePageSchemas', () => {
  it('registers all 13 system pages with fields', () => {
    expect(Object.keys(templatePageSchemas).sort()).toEqual([...EXPECTED_KEYS].sort())
    for (const key of EXPECTED_KEYS) {
      const s = templatePageSchemas[key]
      expect(s, `missing schema for ${key}`).toBeDefined()
      expect(s.slug).toBeTruthy()
      expect(s.title).toBeTruthy()
      expect(Array.isArray(s.fields) && s.fields.length > 0).toBe(true)
    }
  })

  it('keeps every field type valid', () => {
    const validTypes = ['text', 'textarea', 'number', 'boolean', 'image', 'richText', 'array', 'object', 'stringArray']
    for (const s of Object.values(templatePageSchemas)) {
      for (const f of s.fields) {
        expect(validTypes).toContain(f.type)
        if (f.type === 'array') {
          expect(Array.isArray(f.fields) && f.fields.length > 0).toBe(true)
        } else if (f.type === 'object') {
          expect(Array.isArray(f.fields) && f.fields.length > 0).toBe(true)
        }
      }
    }
  })

  it('models careers hero and application as single objects (matches storefront config shape)', () => {
    const careers = templatePageSchemas.careers
    const hero = careers.fields.find(f => f.key === 'hero')
    const application = careers.fields.find(f => f.key === 'application')
    expect(hero?.type).toBe('object')
    expect((hero as any).fields.map((f: any) => f.key)).toEqual(['title', 'subtitle', 'image'])
    expect(application?.type).toBe('object')
    expect((application as any).fields.map((f: any) => f.key)).toEqual(['email', 'ctaText'])
  })

  it('has an array-of-objects items field for faq', () => {
    const faq = templatePageSchemas.faq
    const items = faq.fields.find(f => f.key === 'items')
    expect(items?.type).toBe('array')
    expect((items as any).fields.map((f: any) => f.key)).toEqual(['question', 'answer'])
  })

  it('models stores array with a boolean comingSoon subfield', () => {
    const stores = templatePageSchemas.stores
    const field = stores.fields.find(f => f.key === 'stores')
    expect(field?.type).toBe('array')
    expect((field as any).fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'comingSoon', type: 'boolean' }),
      ]),
    )
  })
})
