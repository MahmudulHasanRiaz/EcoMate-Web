import { createFileRoute } from '@tanstack/react-router'
import { Inventory } from '@/features/inventory'
import { sanitizeSearchParam } from '@/features/inventory/utils/search-param'

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
  // NOTE: every value goes through sanitizeSearchParam — the router's
  // default codec JSON-parses `?q=null` to a real null and `?q=%22null%22`
  // back to the string "null", and a blind `as string | undefined` cast let
  // both (plus numbers/booleans) reach the search box, where the string
  // "null" rendered literally and the write-back preserved it in the URL.
  validateSearch: (
    search: Record<string, unknown>,
  ): { filter?: string; warehouse?: string; view?: string; q?: string } => ({
    filter: sanitizeSearchParam(search.filter),
    warehouse: sanitizeSearchParam(search.warehouse),
    view: sanitizeSearchParam(search.view),
    q: sanitizeSearchParam(search.q),
  }),
})
