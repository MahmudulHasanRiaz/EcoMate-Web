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
    const validTypes = ['text', 'textarea', 'number', 'boolean', 'image', 'richText', 'select', 'array', 'object', 'stringArray']
    const checkFields = (fields: any[]) => {
      for (const f of fields) {
        expect(validTypes).toContain(f.type)
        if (f.type === 'array') {
          expect(Array.isArray(f.fields) && f.fields.length > 0).toBe(true)
          checkFields(f.fields)
        } else if (f.type === 'object') {
          expect(Array.isArray(f.fields) && f.fields.length > 0).toBe(true)
          checkFields(f.fields)
        }
      }
    }
    for (const s of Object.values(templatePageSchemas)) {
      checkFields(s.fields)
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

  it('has an array-of-objects items field for faq with a category', () => {
    const faq = templatePageSchemas.faq
    const items = faq.fields.find(f => f.key === 'items')
    expect(items?.type).toBe('array')
    expect((items as any).fields.map((f: any) => f.key)).toEqual(['question', 'answer', 'category'])
  })

  it('drops the careers jobs array — postings live in the HR panel, not CMS config', () => {
    const careers = templatePageSchemas.careers
    expect(careers.fields.find(f => f.key === 'jobs')).toBeUndefined()
    expect(careers.fields.find(f => f.key === 'benefits')).toBeDefined()
    expect(careers.fields.find(f => f.key === 'application')).toBeDefined()
  })

  it('gives every policy page rich-text section bodies with a stable section id', () => {
    for (const key of ['terms-conditions', 'privacy-policy', 'refund-policy', 'exchange-policy', 'shipping-policy']) {
      const schema = templatePageSchemas[key]
      const sections = schema.fields.find(f => f.key === 'sections')
      expect(sections?.type).toBe('array')
      const sub = (sections as any).fields
      expect(sub.find((f: any) => f.key === 'body')?.type).toBe('richText')
      expect(sub.find((f: any) => f.key === 'id')?.type).toBe('text')
    }
  })

  it('models exchange section roles as a select, not free text', () => {
    const sections = templatePageSchemas['exchange-policy'].fields.find(f => f.key === 'sections') as any
    const kind = sections.fields.find((f: any) => f.key === 'kind')
    expect(kind?.type).toBe('select')
    expect(kind.options.map((o: any) => o.value)).toEqual(['step', 'condition'])
  })

  it('adds qr code, version, and apk fields to the download schema', () => {
    const keys = templatePageSchemas.download.fields.map(f => f.key)
    expect(keys).toEqual(expect.arrayContaining(['qrCodeUrl', 'version', 'apkUrl']))
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
