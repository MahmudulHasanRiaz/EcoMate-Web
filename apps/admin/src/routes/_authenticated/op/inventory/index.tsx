import { createFileRoute } from '@tanstack/react-router'
import { Inventory } from '@/features/inventory'

export const Route = createFileRoute('/_authenticated/op/inventory/')({
  component: Inventory,
  // Deep links + state preservation: the Stock page keeps its search text,
  // warehouse filter and view mode in these params so navigating to a
  // product detail and back restores them. `filter`/`warehouse` are the
  // pre-existing deep-link params (Overview low-stock link, warehouse
  // drawer's "View Filtered Stock"); `view` preselects Managed/Physical
  // (the orphaned /op/inventory/physical route redirects here with
  // ?view=physical).
  // NOTE: the return type's keys must stay OPTIONAL (`filter?:`). If they
  // are required-but-undefined, TanStack makes `search` mandatory on every
  // Link/navigate to this route and rejects partial search objects.
  validateSearch: (
    search: Record<string, unknown>,
  ): { filter?: string; warehouse?: string; view?: string; q?: string } => ({
    filter: search.filter as string | undefined,
    warehouse: search.warehouse as string | undefined,
    view: search.view as string | undefined,
    q: search.q as string | undefined,
  }),
})
