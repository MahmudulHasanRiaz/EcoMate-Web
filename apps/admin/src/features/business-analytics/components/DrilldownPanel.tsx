import { ArrowUpRight, ListTree } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AnalyticsFilters } from '../types'
import { buildOverviewQuery } from '../api'

export interface DrilldownItem {
  label: string
  description: string
  /** Route path (without query). Current filters propagate as params. */
  to: string
  /** Extra dimension params for this drill step. */
  params?: Record<string, string>
}

/** §4.2 overview drill paths — every link propagates the current filter params. */
export function DrilldownPanel({
  filters,
  items,
  queryBuilder = buildOverviewQuery,
}: {
  filters: AnalyticsFilters
  items?: DrilldownItem[]
  /** Inventory pages pass buildInventoryQuery so the warehouse scope propagates. */
  queryBuilder?: (filters: AnalyticsFilters) => Record<string, string>
}) {
  const base = queryBuilder(filters)
  const href = (to: string, params?: Record<string, string>) => {
    const qs = new URLSearchParams({ ...base, ...(params ?? {}) }).toString()
    return `${to}${qs ? `?${qs}` : ''}`
  }
  const rows: DrilldownItem[] = items ?? [
    { label: 'Net Profit → P&L ladder → cost line → orders', description: 'Trace profit into its cost inputs', to: '/op/analytics/overview', params: { view: 'ladder' } },
    { label: 'Contribution → bridge → Delivery Charge Retained', description: 'Single-count bridge operands', to: '/op/analytics/overview', params: { view: 'bridge' } },
    { label: 'Not-yet-recognised pipeline', description: 'Pre-delivery orders by stage', to: '/op/orders', params: { deliveryOutcome: 'in_fulfilment' } },
    { label: 'Fulfillment Margin → per-order settlement', description: 'Full panel lands in P5 (Sales & Orders)', to: '/op/analytics/overview', params: { view: 'fulfillment' } },
    { label: 'Settlement gap → COD orders pending settlement', description: 'Dispatch list for collection-unavailable orders', to: '/op/dispatch', params: { collectionStatus: 'cod-unavailable' } },
    { label: 'Marketing spend → undated-spend fix-list', description: 'Consumptions missing spendDate (P7 full view)', to: '/op/analytics/overview', params: { view: 'coverage' } },
    { label: 'Low product margin → Products → product → variant → orders', description: 'Parent/variant P&L down to Contribution', to: '/op/analytics/products' },
  ]
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
            <ListTree className="h-4 w-4" />
          </span>
          <CardTitle className="text-sm font-medium">Drill Down</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/50">
          {rows.map((i) => (
            <a key={i.label} href={href(i.to, i.params)} className="flex items-center justify-between py-2 transition-all duration-200 hover:bg-muted/40 hover:opacity-95 rounded-lg px-2 -mx-2 min-h-10">
              <span>
                <span className="block text-sm font-medium">{i.label}</span>
                <span className="block text-xs text-muted-foreground">{i.description}</span>
              </span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
