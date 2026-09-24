'use client'

import { useState } from 'react'
import { Scale } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { riseStyle } from '@/components/ui/dashboard'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useBusinessOverview } from './hooks'
import { DEFAULT_FILTERS, formatPct, type AnalyticsFilters } from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { KpiCard } from './components/KpiCard'
import { RecognitionStrip } from './components/RecognitionStrip'
import { ComparisonDelta } from './components/ComparisonDelta'
import { TrendChart } from './components/TrendChart'
import { PnlWaterfall } from './components/PnlWaterfall'
import { ContributionBridge } from './components/ContributionBridge'
import { ComponentOnceLedger } from './components/ComponentOnceLedger'
import { FulfillmentEconomicsPanel } from './components/FulfillmentEconomicsPanel'
import { BreakdownTable } from './components/BreakdownTable'
import { DrilldownPanel } from './components/DrilldownPanel'

/**
 * Business Overview (P3): filters → RecognitionStrip → KPI band → comparison
 * deltas → auto-granularity trend → P&L waterfall → bridge + ledger → compact
 * Fulfillment & Returns Economics card → breakdowns → drill-down. Footer
 * carries meta (formulaVersion, dataAsOf, dateBasis); every number traces to
 * backend meta (§6 auditability), empty-vs-zero honored everywhere (§6).
 */
export default function BusinessOverview() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const { data, isLoading, error, refetch } = useBusinessOverview(filters)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Business Overview</h1>
            <p className="text-xs text-muted-foreground">Recognised revenue only — Delivered is the recognition event.</p>
          </div>
        </div>
      </div>

      <AnalyticsFilterBar value={filters} onChange={setFilters} />

      <WidgetShell
        title="Overview"
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <RecognitionStrip strip={data.data.pnl.strip} />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)}>
              <KpiCard title="Net Sales" kpi={data.data.pnl.lines.netSales} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Gross Profit" kpi={data.data.pnl.lines.grossProfit} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Contribution Profit" kpi={data.data.pnl.lines.contributionProfit} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Net Profit" kpi={data.data.pnl.lines.netProfit} formulaVersion={data.meta.formulaVersion} />
              <KpiCard
                title="Recognition Rate"
                kpi={{
                  value: data.data.pnl.strip.recognitionRate,
                  state: data.data.pnl.strip.recognitionRate === null ? 'no_data' : 'ok',
                  reason: 'Recognised ÷ booked orders',
                  dateBasis: 'Delivered transition vs Order.createdAt',
                }}
                format={(v) => formatPct(v)}
                formulaVersion={data.meta.formulaVersion}
              />
              <KpiCard title="Cash Collected" kpi={data.data.pnl.lenses.cashCollected} formulaVersion={data.meta.formulaVersion} />
            </div>

            <Card className="kpi-card kpi-accent-info animate-rise" style={riseStyle(1)}>
              <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ComparisonDelta label="Net Sales" current={data.data.pnl.lines.netSales.value ?? 0} previous={data.data.comparison.prevNetSales} />
                <ComparisonDelta label="Recognised orders" current={data.data.pnl.strip.recognised} previous={data.data.comparison.prevRecognisedOrders} format={(v) => String(v)} />
                <ComparisonDelta label="Cash collected" current={data.data.pnl.lenses.cashCollected.value ?? 0} previous={data.data.comparison.prevCashCollected} />
              </CardContent>
            </Card>

            <TrendChart points={data.data.trend.points} granularity={data.data.trend.granularity} requestedGranularity={data.data.trend.requestedGranularity} />

            <PnlWaterfall pnl={data.data.pnl} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-rise" style={riseStyle(2)}>
              <ContributionBridge bridge={data.data.pnl.bridge} />
              <ComponentOnceLedger pnl={data.data.pnl} />
            </div>

            <FulfillmentEconomicsPanel fulfillment={data.data.fulfillment} />

            <Tabs defaultValue="channel">
              <TabsList className="tap-h">
                <TabsTrigger value="channel" className="tap-h">Sales Channel</TabsTrigger>
                <TabsTrigger value="source" className="tap-h">Source System</TabsTrigger>
                <TabsTrigger value="category" className="tap-h">Category</TabsTrigger>
              </TabsList>
              <TabsContent value="channel">
                <BreakdownTable title="Net Sales by Sales Channel" rows={data.data.breakdowns.bySalesChannel} hint="Where the sale came from — never merged with Source System." />
              </TabsContent>
              <TabsContent value="source">
                <BreakdownTable title="Net Sales by Source System" rows={data.data.breakdowns.bySource} hint="How the order was created (POS / ECOMMERCE / MANUAL)." />
              </TabsContent>
              <TabsContent value="category">
                <BreakdownTable title="Net Sales by Category (Top 8)" rows={data.data.breakdowns.byCategory} hint="Primary-category attribution — every taka counted once; combo lines expand to components." />
              </TabsContent>
            </Tabs>

            <DrilldownPanel filters={filters} />

            <p className="text-[11px] text-muted-foreground">
              Formula {data.meta.formulaVersion} · Data as of {data.meta.dataAsOf} · {data.meta.dateBasis} · Ladder state:{' '}
              {data.meta.ladderState} · Period {data.meta.range.periodDays} day(s)
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
