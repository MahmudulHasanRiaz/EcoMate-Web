/**
 * Request construction for the Stock page's MANAGED list (acceptance §8.4).
 *
 * The backend stockOverview mode filter is OPT-IN: `?view=managed`
 * restricts the result to MANAGED_STOCK products only. Unscoped calls are
 * unchanged, and the other stock-overview consumers (inventory Overview
 * KPI, inventory detail lookup by productId, Reports all-pages) must stay
 * UNSCOPED — they legitimately need every mode (e.g. the detail page must
 * find an INVENTORY_CONTROLLED product, Reports must see negative stock in
 * any mode). Only the Stock page's Managed-view list fetch uses this
 * builder.
 */
export function managedStockOverviewParams(args: {
  search?: string
  page: number
  perPage: number
  stockSort?: 'asc' | 'desc' | null
}): Record<string, string | number | undefined> {
  return {
    search: args.search || undefined,
    page: args.page,
    perPage: args.perPage,
    sortBy: args.stockSort ? 'stock' : undefined,
    sortOrder: args.stockSort ?? undefined,
    view: 'managed',
  }
}
