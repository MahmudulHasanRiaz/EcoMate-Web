import { ArrowUpRight, ListTree } from 'lucide-react'
import type { AnalyticsFilters } from '../types'
import { buildOverviewQuery } from '../api'
import { EmptyState, SectionHeader } from './analytics-ui'

export interface DrilldownItem {
  label: string
  description: string
  /** Route path (without query). Current filters propagate as params. */
  to: string
  /** Extra dimension params for this drill step. */
  params?: Record<string, string>
}

/**
 * §4.2 overview drill paths — every link propagates the current filter params.
 *
 * Secondary layer, kept discoverable: a compact section with reduced row
 * weight (no data-card chrome), always expanded. Exact-duplicate rows are cut
 * — pass `currentPath` (+ optional `currentParams`, or a full `currentHref`)
 * so the row the user is already on never renders. Same-path rows with
 * different dimension params (e.g. /mon/analytics?view=ladder vs
 * view=bridge) are DIFFERENT drill steps and stay.
 */
export function DrilldownPanel({
  filters,
  items,
  queryBuilder = buildOverviewQuery,
  currentPath,
  currentParams,
  currentHref,
}: {
  filters: AnalyticsFilters
  items?: DrilldownItem[]
  /** Inventory pages pass buildInventoryQuery so the warehouse scope propagates. */
  queryBuilder?: (filters: AnalyticsFilters) => Record<string, string>
  /** Path of the page rendering the panel — only exact (path + params) matches are cut. */
  currentPath?: string
  /** Dimension params of the page rendering the panel (e.g. `{ view: 'ladder' }`). */
  currentParams?: Record<string, string>
  /** Full current location (`path?query`) — takes precedence over currentPath/currentParams. */
  currentHref?: string
}) {
  const base = queryBuilder(filters)
  const href = (to: string, params?: Record<string, string>) => {
    const qs = new URLSearchParams({ ...base, ...(params ?? {}) }).toString()
    return `${to}${qs ? `?${qs}` : ''}`
  }
  const all: DrilldownItem[] = items ?? [
    { label: 'Net Profit → P&L ladder → cost line → orders', description: 'Trace profit into its cost inputs', to: '/mon/analytics', params: { view: 'ladder' } },
    { label: 'Contribution → bridge → Delivery Charge Retained', description: 'Single-count bridge operands', to: '/mon/analytics', params: { view: 'bridge' } },
    { label: 'Not-yet-recognised pipeline', description: 'Pre-delivery orders by stage', to: '/op/orders', params: { deliveryOutcome: 'in_fulfilment' } },
    { label: 'Fulfillment Margin → per-order settlement', description: 'Full panel lands in P5 (Sales & Orders)', to: '/mon/analytics', params: { view: 'fulfillment' } },
    { label: 'Settlement gap → COD orders pending settlement', description: 'Dispatch list for collection-unavailable orders', to: '/op/dispatch', params: { collectionStatus: 'cod-unavailable' } },
    { label: 'Marketing spend → undated-spend fix-list', description: 'Consumptions missing spendDate (P7 full view)', to: '/mon/analytics', params: { view: 'coverage' } },
    { label: 'Low product margin → Products → product → variant → orders', description: 'Parent/variant P&L down to Contribution', to: '/mon/analytics/products' },
  ]
  // Exact-match self-cut. Two forms:
  // - currentPath + currentParams: compare `to` + serialized dimension
  //   params. A row on the same path but with different params (ladder vs
  //   bridge vs fulfillment vs coverage) navigates to a different view state
  //   — keep it. With only currentPath and no currentParams, parameterized
  //   rows stay; only a paramless row on the same path is an exact duplicate.
  // - currentHref: compare the fully built href (base filters + drill params)
  //   against the current location — only a byte-equal row is cut.
  const serializeParams = (p?: Record<string, string>) =>
    Object.entries(p ?? {})
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
  let rows = all
  if (currentHref) {
    rows = all.filter((i) => href(i.to, i.params) !== currentHref)
  } else if (currentPath) {
    const selfKey = serializeParams(currentParams)
    rows = all.filter((i) => !(i.to === currentPath && serializeParams(i.params) === selfKey))
  }
  return (
    <section aria-label="Drill down" className="space-y-2">
      <SectionHeader
        icon={ListTree}
        title="Drill Down"
        tileClassName="bg-info-soft text-info border-info/25"
      />
      {rows.length === 0 ? (
        <EmptyState message="No drill-down paths for this view" />
      ) : (
        <div className="divide-y divide-border/50 rounded-xl border border-border/50 px-3">
          {rows.map((i) => (
            <a
              key={i.label}
              href={href(i.to, i.params)}
              className="-mx-2 flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] transition-colors duration-150 hover:bg-muted/40"
            >
              <span className="min-w-0">
                <span className="block font-medium">{i.label}</span>
                <span className="block text-xs text-muted-foreground">{i.description}</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
