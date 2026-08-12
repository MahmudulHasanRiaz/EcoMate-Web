/**
 * Canonical Meta Catalog identifier resolver (AddToCart catalog-matching fix).
 *
 * The Google Shopping product feed (`apps/backend/src/feed/feed.service.ts`) is
 * the source of truth for what identifier Meta's catalog stores. The feed emits:
 *  - simple product item: id = product.sku || product.id   (feed.service.ts:241)
 *  - variant item:        id = variant.sku || `${product.sku}-${variant.id}`
 *                                                          (feed.service.ts:200)
 *  - variant itemGroupId: product.id                       (feed.service.ts:227)
 *
 * Events must send the SAME id in `content_ids` for Meta catalog matching. The
 * previous implementation sent the internal DB `product.id` UUID, which only
 * matches the catalog when the product has NO sku — hence low match rates.
 *
 * Combos are NOT in the feed (only the Product model is queried); they have no
 * catalog representation, so their content id stays `combo.id`.
 */
export function resolveCatalogId(
  product: { sku?: string | null; id: string },
  variant?: { sku?: string | null; id: string } | null,
): string {
  // Exact parity with feed.service.ts:200 — the feed fallback interpolates
  // `${product.sku}-${variant.id}` verbatim (a null sku renders as `null-...`).
  // variant.sku is schema-required so the fallback is dead in practice, but the
  // event id must stay byte-identical to the feed output for catalog matching.
  if (variant) return variant.sku || `${product.sku}-${variant.id}`;
  return product.sku || product.id;
}

/** Combo items carry no catalog representation — keep the internal id. */
export function keepComboCatalogId(comboId: string): string {
  return comboId;
}