import { describe, it, expect } from 'vitest'
import { slugifyLatin, slugHasChars, resolveProductSlug } from './product-slug'

describe('slugifyLatin', () => {
  it('derives a Bengali-only name to "-" (the bug shape)', () => {
    expect(slugifyLatin('টেস্ট পণ্য')).toBe('-')
  })

  it('lowercases and hyphenates latin names', () => {
    expect(slugifyLatin('Mens WordPress Hoodie')).toBe('mens-wordpress-hoodie')
  })
})

describe('slugHasChars', () => {
  it('rejects "-" and empty strings', () => {
    expect(slugHasChars('-')).toBe(false)
    expect(slugHasChars('')).toBe(false)
    expect(slugHasChars('---')).toBe(false)
  })

  it('accepts slugs with at least one latin letter or digit', () => {
    expect(slugHasChars('a-')).toBe(true)
    expect(slugHasChars('-1')).toBe(true)
    expect(slugHasChars('woo-id-127')).toBe(true)
  })
})

describe('resolveProductSlug', () => {
  it('keeps a usable provided slug untouched', () => {
    expect(resolveProductSlug({ slug: 'my-product', name: 'টেস্ট পণ্য' })).toBe('my-product')
  })

  it('falls back to the derived slug when the provided slug is "-"', () => {
    expect(resolveProductSlug({ slug: '-', name: 'Nice Shirt' })).toBe('nice-shirt')
  })

  it('falls back to the SKU slug when name and slug are both unusable', () => {
    expect(resolveProductSlug({ slug: '-', name: 'টেস্ট পণ্য', sku: 'WOO-ID-127' })).toBe('woo-id-127')
  })

  it('yields product-<timestamp> when everything is Bengali with no SKU', () => {
    const resolved = resolveProductSlug({ slug: '-', name: 'টেস্ট পণ্য', sku: '' })
    expect(resolved).toMatch(/^product-[0-9a-z]+$/)
  })

  it('treats a Bengali-only slug typed into the slug field as empty', () => {
    expect(resolveProductSlug({ slug: 'টেস্ট', name: 'Nice Shirt' })).toBe('nice-shirt')
  })

  it('ignores a Bengali-only SKU and falls through to the timestamp', () => {
    const resolved = resolveProductSlug({ slug: '', name: 'টেস্ট পণ্য', sku: 'টেস্ট' })
    expect(resolved).toMatch(/^product-[0-9a-z]+$/)
  })
})
