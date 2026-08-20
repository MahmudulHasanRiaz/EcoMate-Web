/** Pickers fetch products by a `contains` search; an exact SKU/name match is
 * not guaranteed to rank first (or be on the current page). Re-sort client-side
 * so exact matches always surface at the top. */
export function byExactMatchFirst<T extends { name?: string | null; sku?: string | null }>(
  items: T[],
  q: string,
): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return items
  const score = (it: T) => {
    if ((it.sku ?? '').toLowerCase() === needle) return 0
    if ((it.name ?? '').toLowerCase() === needle) return 1
    if ((it.sku ?? '').toLowerCase().startsWith(needle)) return 2
    if ((it.name ?? '').toLowerCase().startsWith(needle)) return 3
    return 4
  }
  return [...items].sort((a, b) => score(a) - score(b))
}