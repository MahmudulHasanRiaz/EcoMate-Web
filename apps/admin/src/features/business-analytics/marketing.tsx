'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Info } from 'lucide-react'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useMarketingCampaigns, useMarketingSummary, useMarketingUndated } from './hooks'
import {
  ALLOCATED_AT_NOTE,
  ATTRIBUTION_MISMATCH_STATEMENT,
  DEFAULT_FILTERS,
  SPEND_DATE_BASIS_STATEMENT,
  UNDATED_ALLOCATED_AT_CAPTION,
  UNRECOGNISED_SPEND_NOTE,
  formatBDT,
  type AnalyticsFilters,
  type MarketingCostBlock,
  type MarketingTreeCampaign,
  type MarketingUndatedData,
} from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { KpiCard } from './components/KpiCard'
import { DataCoverageBadge } from './components/badges'
import { DrilldownPanel, type DrilldownItem } from './components/DrilldownPanel'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')

const MARKETING_DRILLDOWN: DrilldownItem[] = [
  { label: 'Marketing spend → undated-spend fix-list', description: 'Consumptions missing spendDate → sync/replay', to: '/op/analytics/marketing', params: { view: 'undated' } },
  { label: 'Campaign → ad set → ad → orders', description: 'Recorded insights plus intake attributions down to orders', to: '/op/analytics/marketing', params: { view: 'campaigns' } },
  { label: 'Source revenue → recognised orders', description: 'Marketing-source dimension down to the P&L cohort', to: '/op/orders' },
  { label: 'Never-recognised spend → orders', description: 'Allocations on cancelled or undelivered orders (insight only)', to: '/op/orders' },
  { label: 'Undated row → resync spend', description: 'Spend Snapshots replays the platform sync', to: '/op/marketing/spend-snapshots' },
]

/** §2.4 spend-date basis banner: P&L cost, coverage, allocatedAt honesty. */
export function SpendDateBasisBanner({ cost }: { cost: MarketingCostBlock }) {
  return (
    <Card data-testid="spend-date-basis">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-medium">P&L Marketing Cost — spend-date basis</CardTitle>
          <DataCoverageBadge missing={cost.undatedRows} label="Undated spend" title="Consumptions missing spendDate — excluded from every period total" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{cost.basisStatement || SPEND_DATE_BASIS_STATEMENT}</p>
        <KpiCard title="Marketing Cost" kpi={cost.total} />
        <p className="text-xs text-muted-foreground tabular-nums">
          Dated {cost.datedRows} row(s) · {formatBDT(cost.datedAmount)} in period ·{' '}
          Undated {cost.undatedRows} row(s) · {formatBDT(cost.undatedAmount)} excluded
        </p>
        <p className="text-[11px] text-muted-foreground border-t border-dashed pt-2">
          {cost.allocatedAtNote || ALLOCATED_AT_NOTE}
        </p>
        <a href="#marketing-undated-fixlist" className="text-xs underline underline-offset-2">
          Open the undated-spend fix-list
        </a>
      </CardContent>
    </Card>
  )
}

/** §8.13 — attribution/P&L period mismatch is expected, never a defect. */
export function AttributionMismatchNotice({ disclosure }: { disclosure: string }) {
  return (
    <Card className="border-sky-500/30 bg-sky-500/5" data-testid="attribution-mismatch">
      <CardContent className="pt-4 flex items-start gap-3">
        <Info className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">{disclosure || ATTRIBUTION_MISMATCH_STATEMENT}</p>
      </CardContent>
    </Card>
  )
}

/** Campaign → ad set → ad tree over recorded rows (insight + intake + spend-date bases stated). */
export function CampaignTree({ campaigns }: { campaigns: MarketingTreeCampaign[] }) {
  if (campaigns.length === 0) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
  }
  return (
    <div className="space-y-4" data-testid="campaign-tree">
      {campaigns.map((c) => (
        <Card key={c.campaignId} data-testid={`campaign-node-${c.campaignId}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-medium">{c.name}</CardTitle>
              <span className="flex gap-2">
                {c.platform ? <Badge variant="outline" data-testid={`platform-${c.platform.slug}`}>{c.platform.slug}</Badge> : null}
                <Badge variant="outline">{c.status}</Badge>
              </span>
            </div>
            {c.adAccount ? (
              <p className="text-[11px] text-muted-foreground">{c.adAccount.name} · {c.adAccount.currency}</p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">Platform spend</p>
                <p className="font-medium tabular-nums">{formatBDT(c.insights.spend)}</p>
                <p className="text-[10px] text-muted-foreground">{c.insightsDateBasis}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Attributed revenue</p>
                <p className="font-medium tabular-nums">{formatBDT(c.store.revenue)} · {COUNT_FORMAT(c.store.orders)} order(s)</p>
                <p className="text-[10px] text-muted-foreground">{c.storeDateBasis}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">P&L cost</p>
                <p className="font-medium tabular-nums">{formatBDT(c.pnlCost)}</p>
                <p className="text-[10px] text-muted-foreground">{c.pnlDateBasis}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Undated cost</p>
                <p className="font-medium tabular-nums">{formatBDT(c.undatedCost.amount)} · {c.undatedCost.rows} row(s)</p>
              </div>
            </div>
            {c.adSets.length > 0 ? (
              <div className="space-y-1 pt-1">
                {c.adSets.map((s) => (
                  <div key={s.adSetId} className="rounded-md border border-border/50 px-3 py-2" data-testid={`adset-node-${s.adSetId}`}>
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <p className="text-xs font-medium">{s.name}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatBDT(s.insights.spend)} spend · {formatBDT(s.store.revenue)} attributed · {s.store.orders} order(s)
                      </p>
                    </div>
                    {s.ads.length > 0 ? (
                      <div className="mt-1 space-y-1 pl-3">
                        {s.ads.map((ad) => (
                          <div key={ad.adId} className="flex items-center justify-between flex-wrap gap-1 text-xs" data-testid={`ad-node-${ad.adId}`}>
                            <span className="text-muted-foreground">{ad.name}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {formatBDT(ad.insights.spend)} spend · {formatBDT(ad.store.revenue)} attributed · {ad.store.orders} order(s)
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** Undated-spend coverage fix-list: allocatedAt shown as reference only, sync/replay actions. */
export function UndatedFixList({
  data,
  page,
  onPage,
}: {
  data: MarketingUndatedData
  page: number
  onPage: (p: number) => void
}) {
  return (
    <div data-testid="undated-fixlist">
      <p className="text-xs text-muted-foreground">
        {data.undatedRows} consumption(s) missing spendDate · {formatBDT(data.totalAmount)} excluded from every period total
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">{UNDATED_ALLOCATED_AT_CAPTION}</p>
      {data.rows.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
      ) : (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Campaign</th>
                <th className="py-2 pr-3 font-medium">Amount</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Allocated at (reference)</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-border/50" data-testid={`undated-row-${r.id}`}>
                  <td className="py-2 pr-3 font-medium">{r.campaignName ?? '—'}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatBDT(r.calculatedCost)}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{r.source}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground" title={r.allocatedAtCaption}>
                    {r.allocatedAt ? new Date(r.allocatedAt).toLocaleString() : '—'}
                    <span className="block text-[10px]">reference only — excluded from total</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground flex-wrap gap-2">
        <span>Page {data.page} of {data.totalPages} · {data.total} row(s)</span>
        <span className="flex gap-3">
          {data.fixActions.map((a) => (
            <a key={a.href} href={a.href} className="underline underline-offset-2" data-testid={`fix-action-${a.label}`}>
              {a.label}
            </a>
          ))}
          <button
            className="underline underline-offset-2 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onPage(Math.max(1, page - 1))}
          >
            Prev
          </button>
          <button
            className="underline underline-offset-2 disabled:opacity-40"
            disabled={page >= data.totalPages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </button>
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">{data.allocatedAtNote}</p>
    </div>
  )
}

/**
 * Marketing Analytics (P7, §2.4): spend-date P&L cost with the undated
 * fix-list; source & channel revenue over recognised orders; campaign → ad
 * set → ad tree over recorded rows; new vs returning split; spend on
 * never-recognised orders as an insight. Attribution views state their own
 * basis — period mismatch vs P&L is expected (§8.13).
 */
export default function MarketingAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const { data, isLoading, error, refetch } = useMarketingSummary(filters)
  const campaigns = useMarketingCampaigns(filters)
  const undated = useMarketingUndated(filters, page, pageSize)

  const onFilters = (n: AnalyticsFilters) => {
    setFilters(n)
    setPage(1)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Marketing Analytics</h1>
          <p className="text-xs text-muted-foreground">P&L cost on the spend-date basis. Attribution views sit on their own basis — a period mismatch vs P&L is expected.</p>
        </div>
      </div>

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Marketing"
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <SpendDateBasisBanner cost={data.data.cost} />

            <AttributionMismatchNotice disclosure={data.data.attributionDisclosure} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Revenue by Marketing Source</CardTitle>
                  <p className="text-[11px] text-muted-foreground">{data.data.sources.dateBasis}</p>
                </CardHeader>
                <CardContent>
                  {data.data.sources.rows.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                  ) : (
                    <div className="overflow-x-auto" data-testid="source-table">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Source</th>
                            <th className="py-2 pr-3 font-medium">Orders</th>
                            <th className="py-2 pr-3 font-medium">Revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.data.sources.rows.map((r) => (
                            <tr key={r.key} className="border-t border-border/50" data-testid={`source-row-${r.key}`}>
                              <td className="py-2 pr-3 font-medium">{r.label}</td>
                              <td className="py-2 pr-3 tabular-nums">{COUNT_FORMAT(r.orders)}</td>
                              <td className="py-2 pr-3 tabular-nums font-medium">{formatBDT(r.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Revenue by Sales Channel</CardTitle>
                  <p className="text-[11px] text-muted-foreground">{data.data.channels.dateBasis}</p>
                </CardHeader>
                <CardContent>
                  {data.data.channels.rows.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                  ) : (
                    <div className="overflow-x-auto" data-testid="channel-table">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Channel</th>
                            <th className="py-2 pr-3 font-medium">Orders</th>
                            <th className="py-2 pr-3 font-medium">Revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.data.channels.rows.map((r) => (
                            <tr key={r.key} className="border-t border-border/50" data-testid={`channel-row-${r.key}`}>
                              <td className="py-2 pr-3 font-medium">{r.label}</td>
                              <td className="py-2 pr-3 tabular-nums">{COUNT_FORMAT(r.orders)}</td>
                              <td className="py-2 pr-3 tabular-nums font-medium">{formatBDT(r.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card data-testid="segment-split">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">New vs Returning Revenue</CardTitle>
                <p className="text-[11px] text-muted-foreground">{data.data.segments.dateBasis} · VIP is an of-which subset of returning</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-[11px] text-muted-foreground">New revenue</p>
                    <p className="font-medium tabular-nums">{formatBDT(data.data.segments.newRevenue)}</p>
                    <p className="text-[11px] text-muted-foreground">{COUNT_FORMAT(data.data.segments.newOrders)} order(s)</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Returning revenue</p>
                    <p className="font-medium tabular-nums">{formatBDT(data.data.segments.returningRevenue)}</p>
                    <p className="text-[11px] text-muted-foreground">{COUNT_FORMAT(data.data.segments.returningOrders)} order(s)</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">VIP revenue (of returning)</p>
                    <p className="font-medium tabular-nums">{formatBDT(data.data.segments.vipRevenue)}</p>
                    <p className="text-[11px] text-muted-foreground">{COUNT_FORMAT(data.data.segments.vipOrders)} order(s)</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="unrecognised-spend">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-medium">Spend on Orders That Never Recognised Revenue</CardTitle>
                  <Badge variant="outline" className="bg-sky-500/10 text-sky-600 border-sky-500/20">Insight only</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">{data.data.unrecognisedSpend.dateBasis}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm tabular-nums">
                  <span className="font-medium">{formatBDT(data.data.unrecognisedSpend.amount)}</span>{' '}
                  across {data.data.unrecognisedSpend.allocations} allocation(s) · {data.data.unrecognisedSpend.orders} order(s)
                </p>
                <p className="text-xs text-muted-foreground">{data.data.unrecognisedSpend.note || UNRECOGNISED_SPEND_NOTE}</p>
                {data.data.unrecognisedSpend.rows.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Order</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 pr-3 font-medium">Campaign</th>
                          <th className="py-2 pr-3 font-medium">Allocated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.data.unrecognisedSpend.rows.map((r) => (
                          <tr key={`${r.orderId}-${r.campaignId}`} className="border-t border-border/50">
                            <td className="py-2 pr-3 font-medium">{r.displayId}</td>
                            <td className="py-2 pr-3">{r.status}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{r.campaignName}</td>
                            <td className="py-2 pr-3 tabular-nums">{formatBDT(r.allocatedCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Campaign → Ad Set → Ad</CardTitle>
                <p className="text-[11px] text-muted-foreground">Recorded platform snapshots plus intake attributions — never recomputed. {campaigns.data?.data.disclosure}</p>
              </CardHeader>
              <CardContent>
                {campaigns.data ? (
                  <CampaignTree campaigns={campaigns.data.data.campaigns} />
                ) : campaigns.isLoading ? (
                  <Skeleton className="h-[200px] w-full rounded-lg" />
                ) : (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            <Card id="marketing-undated-fixlist">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-medium">Undated-Spend Fix-List</CardTitle>
                  {undated.data ? (
                    <span className="flex gap-3 text-xs">
                      {undated.data.data.fixActions.map((a) => (
                        <a key={a.href} href={a.href} className="underline underline-offset-2">{a.label}</a>
                      ))}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                {undated.data ? (
                  <UndatedFixList data={undated.data.data} page={page} onPage={setPage} />
                ) : undated.isLoading ? (
                  <Skeleton className="h-[200px] w-full rounded-lg" />
                ) : (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
                )}
              </CardContent>
            </Card>

            <DrilldownPanel filters={filters} items={MARKETING_DRILLDOWN} />

            <p className="text-[11px] text-muted-foreground">
              Formula {data.meta.formulaVersion} · Data as of {data.meta.dataAsOf} · {data.meta.dateBasis} · Period {data.meta.range.periodDays} day(s)
            </p>
          </div>
        ) : isLoading ? (
          <Skeleton className="h-[400px] w-full rounded-lg" />
        ) : (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        )}
      </WidgetShell>
    </div>
  )
}
