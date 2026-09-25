'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Info, Megaphone } from 'lucide-react'
import { riseStyle } from '@/components/ui/dashboard'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useMarketingCampaigns, useMarketingSummary, useMarketingUndated } from './hooks'
import {
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
import { AnalyticsPageHeader, AnalyticsSection, EmptyState, MetricMetaFooter } from './components/analytics-ui'
import { KpiCard } from './components/KpiCard'
import { DataCoverageBadge } from './components/badges'
import { DrilldownPanel, type DrilldownItem } from './components/DrilldownPanel'
import { MarketingKpiWidget } from '../analytics/components/MarketingKpiWidget'
import { TrafficSourcesChart } from '../analytics/components/TrafficSourcesChart'
import { useLicenseStore } from '../../stores/license-store'

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')

const MARKETING_DRILLDOWN: DrilldownItem[] = [
  { label: 'Marketing spend → undated-spend fix-list', description: 'Consumptions missing spendDate → sync/replay', to: '/mon/analytics/marketing', params: { view: 'undated' } },
  { label: 'Campaign → ad set → ad → orders', description: 'Recorded insights plus intake attributions down to orders', to: '/op/orders' },
  { label: 'Source revenue → recognised orders', description: 'Marketing-source dimension down to the P&L cohort', to: '/op/orders' },
  { label: 'Never-recognised spend → orders', description: 'Allocations on cancelled or undelivered orders (insight only)', to: '/op/orders' },
  { label: 'Undated row → resync spend', description: 'Spend Snapshots replays the platform sync', to: '/op/marketing/spend-snapshots' },
]

/**
 * §2.4 spend-date basis banner (W3): a section, never a Card nesting a
 * KpiCard. The allocatedAt honesty note lives in the fix-list caption only —
 * the banner keeps the period summary counts (its own scope).
 */
export function SpendDateBasisBanner({ cost, formulaVersion }: { cost: MarketingCostBlock; formulaVersion?: string }) {
  return (
    <section aria-label="P&L Marketing Cost — spend-date basis" data-testid="spend-date-basis" className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold">P&L Marketing Cost — spend-date basis</h2>
        <DataCoverageBadge missing={cost.undatedRows} label="Undated spend" title="Consumptions missing spendDate — excluded from every period total" />
      </div>
      <p className="text-xs text-muted-foreground">{cost.basisStatement || SPEND_DATE_BASIS_STATEMENT}</p>
      <KpiCard title="Marketing Cost" kpi={cost.total} formulaVersion={formulaVersion} animate={false} />
      <p className="text-xs text-muted-foreground tabular-nums">
        Dated {cost.datedRows} row(s) · {formatBDT(cost.datedAmount)} in period ·{' '}
        Undated {cost.undatedRows} row(s) · {formatBDT(cost.undatedAmount)} excluded
      </p>
      <a href="#marketing-undated-fixlist" className="inline-block text-xs underline underline-offset-2">
        Open the undated-spend fix-list
      </a>
    </section>
  )
}

/** §8.13 — attribution/P&L period mismatch is expected, never a defect. Compact notice, not a card. */
export function AttributionMismatchNotice({ disclosure }: { disclosure: string }) {
  return (
    <div data-testid="attribution-mismatch" className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-soft p-3">
      <Info className="h-4 w-4 text-info shrink-0 mt-0.5" aria-hidden />
      <p className="text-xs text-muted-foreground">{disclosure || ATTRIBUTION_MISMATCH_STATEMENT}</p>
    </div>
  )
}

/**
 * Campaign → ad set → ad tree over recorded rows (W3): campaigns are flat
 * sections (never Cards-in-Card); ad sets are collapsed <details> by default
 * so a 20-campaign page stays scannable — keyboard and tap native to summary.
 */
export function CampaignTree({ campaigns }: { campaigns: MarketingTreeCampaign[] }) {
  if (campaigns.length === 0) {
    return <EmptyState />
  }
  return (
    <div className="divide-y divide-border/50" data-testid="campaign-tree">
      {campaigns.map((c) => (
        <section key={c.campaignId} aria-label={c.name} data-testid={`campaign-node-${c.campaignId}`} className="space-y-2 py-4 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-medium">{c.name}</h3>
            <span className="flex gap-2">
              {c.platform ? <Badge variant="outline" data-testid={`platform-${c.platform.slug}`}>{c.platform.slug}</Badge> : null}
              <Badge variant="outline">{c.status}</Badge>
            </span>
          </div>
          {c.adAccount ? (
            <p className="text-[11px] text-muted-foreground">{c.adAccount.name} · {c.adAccount.currency}</p>
          ) : null}
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
            <div className="space-y-1.5 pt-1">
              {c.adSets.map((s) => (
                <details key={s.adSetId} className="rounded-md border border-border/50 px-3 py-1" data-testid={`adset-node-${s.adSetId}`}>
                  <summary className="flex cursor-pointer items-center justify-between flex-wrap gap-1 py-1.5 text-xs rounded focus-visible:outline-2 focus-visible:outline-offset-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatBDT(s.insights.spend)} spend · {formatBDT(s.store.revenue)} attributed · {s.store.orders} order(s)
                    </span>
                  </summary>
                  {s.ads.length > 0 ? (
                    <div className="mt-1 space-y-1 border-t border-border/50 py-1.5 pl-3">
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
                </details>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}

/**
 * Undated-spend coverage fix-list (W3): the single home of the allocatedAt
 * honesty note (caption) — the banner and footer duplicates are gone. The
 * fix actions render here once (the section header no longer repeats them).
 * Pager follows the Button idiom, never text-buttons.
 */
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
        <EmptyState />
      ) : (
        <div className="overflow-x-auto mt-2">
          <table className="dash-table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Campaign</th>
                <th className="py-2 pr-3 font-medium text-right">Amount</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Allocated at (reference)</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`undated-row-${r.id}`}>
                  <td className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">{r.campaignName ?? '—'}</td>
                  <td className="py-2 pr-3 tabular-nums text-right">{formatBDT(r.calculatedCost)}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{r.source}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {r.allocatedAt ? new Date(r.allocatedAt).toLocaleString() : '—'}
                    <span className="block text-[10px]">reference only — excluded from total</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground flex-wrap gap-2" data-testid="undated-pager">
        <span>Page {data.page} of {data.totalPages} · {data.total} row(s)</span>
        <span className="flex gap-2 flex-wrap items-center">
          {data.fixActions.map((a) => (
            <a key={a.href} href={a.href} className="underline underline-offset-2 px-1 py-2 min-h-[44px] inline-flex items-center" data-testid={`fix-action-${a.label}`}>
              {a.label}
            </a>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="tap-h cursor-pointer"
            disabled={page <= 1}
            onClick={() => onPage(Math.max(1, page - 1))}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="tap-h cursor-pointer"
            disabled={page >= data.totalPages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </span>
      </div>
    </div>
  )
}

/**
 * Marketing Analytics (P7, §2.4): spend-date P&L cost with the undated
 * fix-list; source & channel revenue over recognised orders; campaign → ad
 * set → ad tree over recorded rows; new vs returning split; spend on
 * never-recognised orders as an insight. Attribution views state their own
 * basis — period mismatch vs P&L is expected (§8.13).
 *
 * First viewport tells Spend → Revenue → Efficiency: the cost banner, then
 * attributed revenue, then the segment split and the never-recognised
 * insight. Campaign tree and fix-list follow below.
 */
export default function MarketingAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const { data, isLoading, error, refetch } = useMarketingSummary(filters)
  const campaigns = useMarketingCampaigns(filters)
  const undated = useMarketingUndated(filters, page, pageSize)
  const showGa4 = useLicenseStore((s) => s.hasFeature('integration_ga4'))
  // GA4 web-traffic sits on a session basis — never mixed with the spend-date
  // P&L cost or the recognised-revenue attribution above.
  const ga4Range = { startDate: filters.startDate, endDate: filters.endDate }

  const onFilters = (n: AnalyticsFilters) => {
    setFilters(n)
    setPage(1)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <AnalyticsPageHeader
        icon={Megaphone}
        title="Marketing Analytics"
        subtitle="P&L cost on the spend-date basis. Attribution views sit on their own basis — a period mismatch vs P&L is expected."
        tileClassName="bg-accent-pink-soft text-accent-pink border-accent-pink/25"
      />

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Marketing"
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <div className="animate-rise" style={riseStyle(0)}>
              <SpendDateBasisBanner cost={data.data.cost} formulaVersion={data.meta.formulaVersion} />
            </div>

            <AttributionMismatchNotice disclosure={data.data.attributionDisclosure} />

            <div className="animate-rise" style={riseStyle(1)}>
              <AnalyticsSection title="Attributed revenue" subtext="Recognised orders by source and channel — attribution bases, never the P&L spend-date basis.">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card className="chart-card rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Revenue by Marketing Source</CardTitle>
                      <p className="text-[11px] text-muted-foreground">{data.data.sources.dateBasis}</p>
                    </CardHeader>
                    <CardContent>
                      {data.data.sources.rows.length === 0 ? (
                        <EmptyState />
                      ) : (
                        <div className="overflow-x-auto" data-testid="source-table">
                          <table className="dash-table w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-muted-foreground">
                                <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Source</th>
                                <th className="py-2 pr-3 font-medium text-right">Orders</th>
                                <th className="py-2 pr-3 font-medium text-right">Revenue</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.data.sources.rows.map((r) => (
                                <tr key={r.key} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`source-row-${r.key}`}>
                                  <td className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">{r.label}</td>
                                  <td className="py-2 pr-3 tabular-nums text-right">{COUNT_FORMAT(r.orders)}</td>
                                  <td className="py-2 pr-3 tabular-nums font-medium text-right">{formatBDT(r.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="chart-card rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Revenue by Sales Channel</CardTitle>
                      <p className="text-[11px] text-muted-foreground">{data.data.channels.dateBasis}</p>
                    </CardHeader>
                    <CardContent>
                      {data.data.channels.rows.length === 0 ? (
                        <EmptyState />
                      ) : (
                        <div className="overflow-x-auto" data-testid="channel-table">
                          <table className="dash-table w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-muted-foreground">
                                <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Channel</th>
                                <th className="py-2 pr-3 font-medium text-right">Orders</th>
                                <th className="py-2 pr-3 font-medium text-right">Revenue</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.data.channels.rows.map((r) => (
                                <tr key={r.key} className="border-t border-border/50 transition-colors hover:bg-muted/40" data-testid={`channel-row-${r.key}`}>
                                  <td className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">{r.label}</td>
                                  <td className="py-2 pr-3 tabular-nums text-right">{COUNT_FORMAT(r.orders)}</td>
                                  <td className="py-2 pr-3 tabular-nums font-medium text-right">{formatBDT(r.revenue)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </AnalyticsSection>
            </div>

            <div className="animate-rise" style={riseStyle(2)}>
              <AnalyticsSection
                title="New vs Returning Revenue"
                subtext={`${data.data.segments.dateBasis} · VIP is an of-which subset of returning`}
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm" data-testid="segment-split">
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
              </AnalyticsSection>
            </div>

            <div className="animate-rise" style={riseStyle(3)}>
              <Card data-testid="unrecognised-spend" className="chart-card rounded-2xl">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm font-medium">Spend on Orders That Never Recognised Revenue</CardTitle>
                    <Badge variant="info">Insight only</Badge>
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
                      <table className="dash-table w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">Order</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 pr-3 font-medium">Campaign</th>
                            <th className="py-2 pr-3 font-medium text-right">Allocated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.data.unrecognisedSpend.rows.map((r) => (
                            <tr key={`${r.orderId}-${r.campaignId}`} className="border-t border-border/50 transition-colors hover:bg-muted/40">
                              <td className="py-2 pr-3 font-medium sticky left-0 bg-card z-10">{r.displayId}</td>
                              <td className="py-2 pr-3">{r.status}</td>
                              <td className="py-2 pr-3 text-muted-foreground">{r.campaignName}</td>
                              <td className="py-2 pr-3 tabular-nums text-right">{formatBDT(r.allocatedCost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="animate-rise" style={riseStyle(4)}>
              <AnalyticsSection title="Campaign → Ad Set → Ad" subtext={`Recorded platform snapshots plus intake attributions — never recomputed. ${campaigns.data?.data.disclosure ?? ''}`}>
                {campaigns.data ? (
                  <CampaignTree campaigns={campaigns.data.data.campaigns} />
                ) : campaigns.isLoading ? (
                  <Skeleton className="h-[200px] w-full rounded-lg" />
                ) : (
                  <EmptyState />
                )}
              </AnalyticsSection>
            </div>

            <div id="marketing-undated-fixlist" className="scroll-mt-4 animate-rise" style={riseStyle(5)}>
              <AnalyticsSection title="Undated-Spend Fix-List" subtext="Consumptions missing spendDate — resync or replay to date them.">
                {undated.data ? (
                  <UndatedFixList data={undated.data.data} page={page} onPage={setPage} />
                ) : undated.isLoading ? (
                  <Skeleton className="h-[200px] w-full rounded-lg" />
                ) : (
                  <EmptyState />
                )}
              </AnalyticsSection>
            </div>

            {showGa4 ? (
              <section aria-label="Web traffic (GA4)">
                <p className="text-sm font-medium">Web Traffic (GA4)</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                  Session-based web traffic — a separate basis from P&L cost and recognised-revenue attribution. Never mixed into totals.
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <MarketingKpiWidget dateRange={ga4Range} />
                  <TrafficSourcesChart dateRange={ga4Range} />
                </div>
              </section>
            ) : null}

            <DrilldownPanel filters={filters} items={MARKETING_DRILLDOWN} />

            <MetricMetaFooter
              formulaVersion={data.meta.formulaVersion}
              dataAsOf={data.meta.dataAsOf}
              dateBasis={data.meta.dateBasis}
              ladderState={data.meta.ladderState}
              periodDays={data.meta.range.periodDays}
            />
          </div>
        ) : isLoading ? (
          <Skeleton className="h-[400px] w-full rounded-lg" />
        ) : (
          <EmptyState />
        )}
      </WidgetShell>
    </div>
  )
}
