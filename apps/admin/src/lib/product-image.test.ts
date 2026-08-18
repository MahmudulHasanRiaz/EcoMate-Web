import { describe, expect, it } from 'vitest'
import {
  colorValueOf,
  firstValidImage,
  productPrimaryImage,
  resolveImageEntry,
  resolveOrderItemImages,
  siblingColorImage,
  variantPrimaryImage,
  type ProductImageSource,
  type ProductVariantImageSource,
} from './product-image'

const VAR_BLACK_M = 'variant-black-m'
const VAR_BLACK_S = 'variant-black-s'
const VAR_BLUE = 'variant-blue'
const VAR_RED = 'variant-red'

function attributeValue(value: string, opts?: { hexCode?: string; attribute?: string }) {
  return {
    attributeValue: {
      value,
      hexCode: opts?.hexCode ?? null,
      attribute: { name: opts?.attribute ?? 'Color' },
    },
  }
}

function variant(
  id: string,
  image: string | null,
  av: ReturnType<typeof attributeValue>[],
): ProductVariantImageSource {
  return { id, image, attributeValues: av } as ProductVariantImageSource
}

function catalog(variants: ProductVariantImageSource[], images: unknown[] = []): ProductImageSource {
  return { id: 'product-1', name: 'Test Product', images, variants } as ProductImageSource
}

describe('resolveImageEntry', () => {
  it('accepts strings', () => {
    expect(resolveImageEntry('/uploads/a.png')).toBe('/uploads/a.png')
  })

  it('accepts objects with url/src/path', () => {
    expect(resolveImageEntry({ url: '/u/x.png' })).toBe('/u/x.png')
    expect(resolveImageEntry({ src: '/u/y.png' })).toBe('/u/y.png')
    expect(resolveImageEntry({ path: '/u/z.png' })).toBe('/u/z.png')
  })

  it('returns null for invalid entries', () => {
    expect(resolveImageEntry(null)).toBeNull()
    expect(resolveImageEntry(undefined)).toBeNull()
    expect(resolveImageEntry(42)).toBeNull()
    expect(resolveImageEntry({})).toBeNull()
    expect(resolveImageEntry('')).toBeNull()
    expect(resolveImageEntry('  ')).toBeNull()
  })
})

describe('firstValidImage', () => {
  it('returns first valid entry from mixed arrays', () => {
    expect(firstValidImage(['', { src: '/ok.png' }, 'x'])).toBe('/ok.png')
    expect(firstValidImage([null, '/a.png'])).toBe('/a.png')
    expect(firstValidImage(undefined)).toBeNull()
    expect(firstValidImage([])).toBeNull()
  })
})

describe('variantPrimaryImage', () => {
  it('prefers the explicit image field over the images array', () => {
    const v = variant(VAR_BLUE, '/single.png', [])
    v.images = ['/array.png']
    expect(variantPrimaryImage(v)).toBe('/single.png')
  })

  it('falls back to the images array', () => {
    const v = variant(VAR_BLUE, null, [])
    v.images = ['/first.png', '/second.png']
    expect(variantPrimaryImage(v)).toBe('/first.png')
  })

  it('returns null when no images', () => {
    expect(variantPrimaryImage(variant(VAR_BLUE, null, []))).toBeNull()
  })
})

describe('colorValueOf', () => {
  it('prefers hexCode-carrying attribute values', () => {
    expect(
      colorValueOf(variant('v1', null, [
        attributeValue('Black', { hexCode: '#000000' }),
        attributeValue('Medium', { attribute: 'Size' }),
      ])),
    ).toEqual({ attributeName: 'Color', value: 'Black' })
  })

  it('falls back to a Color attribute value', () => {
    expect(colorValueOf(variant('v1', null, [attributeValue('Red')]))).toEqual({
      attributeName: 'Color',
      value: 'Red',
    })
  })

  it('matches color-named attributes case-insensitively', () => {
    expect(colorValueOf(variant('v1', null, [attributeValue('Green', { attribute: 'color' })])).value).toBe('Green')
    expect(colorValueOf(variant('v1', null, [attributeValue('Blue', { attribute: 'Colour' })])).value).toBe('Blue')
    expect(colorValueOf(variant('v1', null, [attributeValue('رنگ', { attribute: 'رنگ' })])).value).toBe('رنگ')
  })

  it('ignores non-color attributes', () => {
    expect(colorValueOf(variant('v1', null, [attributeValue('Large', { attribute: 'Size' })]) )).toBeNull()
  })

  it('returns null when no color value', () => {
    expect(colorValueOf(variant('v1', null, []))).toBeNull()
  })
})

describe('siblingColorImage', () => {
  const variants = [
    variant(VAR_BLACK_S, '/black-s.png', [attributeValue('Black', { hexCode: '#000000' })]),
    variant(VAR_BLACK_M, null, [attributeValue('Black', { hexCode: '#000000' })]),
    variant(VAR_BLUE, '/blue.png', [attributeValue('Blue', { hexCode: '#0000ff' })]),
    variant(VAR_RED, null, [attributeValue('Red', { hexCode: '#ff0000' })]),
  ]
  const product = catalog(variants)

  it('matches a sibling variant sharing the exact color value', () => {
    expect(siblingColorImage(variant(VAR_BLACK_M, null, [attributeValue('Black', { hexCode: '#000000' })]), product)).toBe('/black-s.png')
  })

  it('is case-insensitive and trims', () => {
    const spaced = variant('v9', null, [attributeValue('  blue ', { hexCode: '#0000ff' })])
    expect(siblingColorImage(spaced, product)).toBe('/blue.png')
  })

  it('returns null when no sibling carries an image', () => {
    expect(siblingColorImage(variant(VAR_RED, null, [attributeValue('Red', { hexCode: '#ff0000' })]), product)).toBeNull()
    expect(siblingColorImage(variant('v99', null, [attributeValue('Missing', { hexCode: '#ffffff' })]), product)).toBeNull()
  })

  it('handles a missing product', () => {
    expect(siblingColorImage(variant(VAR_BLUE, null, [attributeValue('Blue')]), undefined)).toBeNull()
  })
})

describe('productPrimaryImage', () => {
  it('takes first valid product image', () => {
    expect(productPrimaryImage(catalog([], [{ src: '/prod.png' }, '/ignored.png']))).toBe('/prod.png')
    expect(productPrimaryImage(catalog([], ['/prod.png']))).toBe('/prod.png')
  })

  it('returns null for empty product images', () => {
    expect(productPrimaryImage(catalog([], []))).toBeNull()
    expect(productPrimaryImage(catalog([]))).toBeNull()
    expect(productPrimaryImage(undefined)).toBeNull()
  })
})

describe('resolveOrderItemImages', () => {
  it('uses the variant image when present', () => {
    const variants = [
      variant(VAR_BLACK_S, '/black-s.png', [attributeValue('Black', { hexCode: '#000000' })]),
      variant(VAR_BLACK_M, null, [attributeValue('Black', { hexCode: '#000000' })]),
    ]
    const source = catalog(variants, ['/prod.png'])
    const resolved = resolveOrderItemImages(source, variant(VAR_BLACK_M, '/own.png', []))
    expect(resolved).toEqual({
      image: '/own.png',
      colorImage: null,
      productImage: '/prod.png',
      hasImage: true,
    })
  })

  it('falls back to color sibling when variant image is missing (Black/M)', () => {
    const variants = [
      variant(VAR_BLACK_S, '/black-s.png', [attributeValue('Black', { hexCode: '#000000' })]),
      variant(VAR_BLACK_M, null, [
        attributeValue('Black', { hexCode: '#000000' }),
        attributeValue('M', { attribute: 'Size' }),
      ]),
    ]
    const source = catalog(variants, ['/prod.png'])
    const resolved = resolveOrderItemImages(
      source,
      variant(VAR_BLACK_M, null, [
        attributeValue('Black', { hexCode: '#000000' }),
        attributeValue('M', { attribute: 'Size' }),
      ]),
    )
    expect(resolved.image).toBe('/black-s.png')
    expect(resolved.colorImage).toBe('/black-s.png')
    expect(resolved.productImage).toBe('/prod.png')
    expect(resolved.hasImage).toBe(true)
  })

  it('falls back to parent product image when no color sibling exists (Red/M)', () => {
    const variants = [variant(VAR_RED, null, [attributeValue('Red', { hexCode: '#ff0000' })])]
    const source = catalog(variants, ['/prod.png'])
    const resolved = resolveOrderItemImages(
      source,
      variant(VAR_RED, null, [attributeValue('Red', { hexCode: '#ff0000' })]),
    )
    expect(resolved.image).toBe('/prod.png')
    expect(resolved.colorImage).toBeNull()
    expect(resolved.productImage).toBe('/prod.png')
    expect(resolved.hasImage).toBe(true)
  })

  it('reports no image when everything is missing (placeholder case)', () => {
    const variants = [variant(VAR_RED, null, [attributeValue('Red')])]
    const resolved = resolveOrderItemImages(catalog(variants), variant(VAR_RED, null, []))
    expect(resolved.hasImage).toBe(false)
    expect(resolved.image).toBeNull()
    expect(resolved.colorImage).toBeNull()
    expect(resolved.productImage).toBeNull()
  })

  it('handles a missing variant and missing catalog', () => {
    expect(resolveOrderItemImages(undefined, undefined)).toEqual({
      image: null,
      colorImage: null,
      productImage: null,
      hasImage: false,
    })
  })

  it('handles deleted/invalid image refs', () => {
    const variants = [variant(VAR_BLACK_S, '', [attributeValue('Black', { hexCode: '#000000' })])]
    const source = catalog(variants, [null, '', { src: 42 }])
    const resolved = resolveOrderItemImages(
      source,
      variant(VAR_BLACK_M, '', [attributeValue('Black', { hexCode: '#000000' })]),
    )
    expect(resolved.hasImage).toBe(false)
  })

  it('handles products with no variants at all', () => {
    const resolved = resolveOrderItemImages(catalog([], ['/prod.png']), undefined)
    expect(resolved.image).toBe('/prod.png')
    expect(resolved.productImage).toBe('/prod.png')
    expect(resolved.colorImage).toBeNull()
    expect(resolved.hasImage).toBe(true)
  })
})