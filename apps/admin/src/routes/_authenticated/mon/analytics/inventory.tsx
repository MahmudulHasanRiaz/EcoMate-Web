import { createFileRoute } from '@tanstack/react-router'
import InventoryAnalytics from '@/features/business-analytics/inventory'

export const Route = createFileRoute('/_authenticated/mon/analytics/inventory')({
  component: InventoryRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || undefined,
    productId: (search.productId as string) || undefined,
    variantId: (search.variantId as string) || undefined,
  }),
})

function InventoryRoute() {
  const search = Route.useSearch()
  return <InventoryAnalytics initialSearch={search} />
}
