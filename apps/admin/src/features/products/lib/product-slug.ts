// Latin-only slug helpers (shared by the product form).
//
// A Bengali-only name derives "-" from the latin-only regex, and "-"
// is truthy, so `slug || derivedSlug || ...` silently keeps it. Any
// derived/provided slug with no latin letter or digit is treated as
// EMPTY so the fallback chain actually triggers.

/** Latin-only slug derivation (lowercase, spaces → -, strip the rest). */
export function slugifyLatin(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

/** True when the slug contains at least one latin letter or digit. */
export function slugHasChars(slug: string): boolean {
  return /[a-z0-9]/.test(slug)
}

/**
 * Resolve the slug a save actually sends. Fallback order: the provided
 * slug (when usable) → derived from the name → derived from the SKU →
 * `product-<base36 timestamp>`. A product whose info is entirely in
 * Bengali with no SKU still yields a valid ASCII, unique slug; no
 * transliteration is attempted.
 */
export function resolveProductSlug(input: {
  slug?: string
  name?: string
  sku?: string
}): string {
  const provided = input.slug || ''
  if (provided && slugHasChars(provided)) return provided
  const derived = slugifyLatin(input.name || '')
  if (derived && slugHasChars(derived)) return derived
  const skuSlug = slugifyLatin(input.sku || '')
  if (skuSlug && slugHasChars(skuSlug)) return skuSlug
  return `product-${Date.now().toString(36)}`
}
