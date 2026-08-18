/**
 * Canonical product / variant image resolution strategy.
 *
 * SINGLE source of truth for "which image does this order line show?"
 * Used by packing, order list/detail, order creation pickers and any future
 * surface. Do NOT inline image-picking logic in components.
 *
 * Resolution hierarchy (deterministic, in order):
 *
 *   Single (non-variant) product:
 *     1. product primary image  (first valid entry of product.images)
 *     2. no valid image → null (caller renders controlled placeholder)
 *
 *   Variable product — for a given order line / variant:
 *     1. variant's own image        (variant.image, then variant.images[0])
 *     2. color-representative image — the sibling variant sharing the SAME
 *        color attribute value (e.g. Black / M falls back to Black / S when
 *        the / M variant has no image; Red / M resolves Red early).
 *        The "color" attribute is identified canonically: an attribute whose
 *        values carry hexCode, else by name (color / colour / رنگ / রঙ).
 *     3. parent product primary image
 *     4. no valid image → null (controlled placeholder)
 *
 * A URL is "valid" iff it is a non-empty trimmed string (string entries) or an
 * object with a non-empty url/path/src member. Entries of any other type are
 * ignored — a broken/invalid reference can never shadow a valid image below it.
 */

export interface ImageEntryObject {
  url?: string | null
  path?: string | null
  src?: string | null
  [key: string]: unknown
}

export type ImageEntry = string | ImageEntryObject | null | undefined

export interface AttributeValueLink {
  attributeValue?: {
    value?: string | null
    hexCode?: string | null
    attribute?: { name?: string | null } | null
  } | null
}

export interface ProductVariantImageSource {
  id?: string | null
  image?: string | null
  images?: ImageEntry[] | ImageEntry | null
  attributeValues?: AttributeValueLink[] | null
}

export interface ProductImageSource {
  id?: string | null
  type?: string | null
  images?: ImageEntry[] | ImageEntry | null
  image?: string | null
  variants?: ProductVariantImageSource[] | null
}

export interface ResolvedOrderItemImages {
  /** Our best image: variant image when present, else color, else product. */
  image: string | null
  /** Color-representative sibling image (variable products only). */
  colorImage: string | null
  /** Parent product fallback image. */
  productImage: string | null
  /** True when any tier produced a usable URL. */
  hasImage: boolean
}

const COLOR_ATTR_NAMES = [
  /^\s*color\s*$/i,
  /^\s*colour\s*$/i,
  /^\s*colorway\s*$/i,
  /^\s*رنگ\s*$/,
  /^\s*রঙ\s*$/,
]

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0
}

/** Extract a usable URL from a single image entry. */
export function resolveImageEntry(entry: ImageEntry): string | null {
  if (typeof entry === 'string') {
    return entry.trim() || null
  }
  if (entry && typeof entry === 'object') {
    for (const key of ['url', 'path', 'src'] as const) {
      const value = entry[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return null
}

/** First valid URL in a list (string or object entries), else null. */
export function firstValidImage(list: ImageEntry[] | ImageEntry | null | undefined): string | null {
  if (!list) return null
  if (!Array.isArray(list)) return resolveImageEntry(list)
  for (const entry of list) {
    const resolved = resolveImageEntry(entry)
    if (resolved) return resolved
  }
  return null
}

/** Variant's own image: explicit image field first, then images list. */
export function variantPrimaryImage(
  variant: ProductVariantImageSource | null | undefined,
): string | null {
  if (!variant) return null
  return resolveImageEntry(variant.image) ?? firstValidImage(variant.images)
}

/** Product primary image. */
export function productPrimaryImage(
  product: ProductImageSource | null | undefined,
): string | null {
  if (!product) return null
  return firstValidImage(product.images) ?? resolveImageEntry(product.image)
}

/**
 * The variant's color attribute value, if any. An attribute is treated as the
 * color attribute when its values carry hexCode (swatch), else by name match.
 */
export function colorValueOf(
  variant: ProductVariantImageSource | null | undefined,
): { attributeName: string; value: string } | null {
  if (!variant?.attributeValues) return null
  let byName: { attributeName: string; value: string } | null = null
  for (const link of variant.attributeValues) {
    const av = link?.attributeValue
    if (!av) continue
    const value = av.value ?? ''
    if (value.trim() === '') continue
    const name = av.attribute?.name ?? ''
    if (!isBlank(av.hexCode)) {
      return { attributeName: name || 'color', value: value.trim() }
    }
    if (byName === null && COLOR_ATTR_NAMES.some((re) => re.test(name))) {
      byName = { attributeName: name, value: value.trim() }
    }
  }
  return byName
}

/**
 * First sibling variant (same product, different variant) sharing the same
 * color value whose own image is valid. Returns the image URL, else null.
 */
export function siblingColorImage(
  variant: ProductVariantImageSource | null | undefined,
  product: ProductImageSource | null | undefined,
): string | null {
  if (!variant || !product?.variants) return null
  const color = colorValueOf(variant)
  if (!color) return null
  for (const sibling of product.variants) {
    if (!sibling || !sibling.id) continue
    if (sibling.id === variant.id) continue
    const siblingColor = colorValueOf(sibling)
    if (
      siblingColor &&
      siblingColor.value.toLocaleLowerCase() === color.value.toLocaleLowerCase()
    ) {
      const image = variantPrimaryImage(sibling)
      if (image) return image
    }
  }
  return null
}

/**
 * Canonical tiered resolution for an order line (product + optional variant).
 * The returned contract maps directly onto <SafeImage src fallbackSrc>:
 *   src        = image            (variant → color → product)
 *   fallbackSrc= colorImage || productImage (strict priority preserved)
 */
export function resolveOrderItemImages(
  product: ProductImageSource | null | undefined,
  variant: ProductVariantImageSource | null | undefined,
): ResolvedOrderItemImages {
  const productImage = productPrimaryImage(product)
  if (!variant) {
    return { image: productImage, colorImage: null, productImage, hasImage: Boolean(productImage) }
  }
  const variantImage = variantPrimaryImage(variant)
  const colorImage = variantImage ? null : siblingColorImage(variant, product)
  const image = variantImage ?? colorImage ?? productImage
  return { image, colorImage, productImage, hasImage: Boolean(image) }
}