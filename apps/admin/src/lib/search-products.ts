/** Pickers fetch products by a `contains` search; an exact SKU/name match is
 * not guaranteed to rank first (or be on the current page). Re-sort client-side
 * so exact matches always surface at the top. */
export function byExactMatchFirst<T>(items: T[], q: string): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return items
  const score = (it: T) => {
    const sku = String((it as any)?.sku ?? '')
    const name = String((it as any)?.name ?? '')
    if (sku.toLowerCase() === needle) return 0
    if (name.toLowerCase() === needle) return 1
    if (sku.toLowerCase().startsWith(needle)) return 2
    if (name.toLowerCase().startsWith(needle)) return 3
    return 4
  }
  return [...items].sort((a, b) => score(a) - score(b))
}