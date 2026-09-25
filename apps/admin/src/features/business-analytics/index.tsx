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
import { AnalyticsPageHeader, AnalyticsSection, MetricMetaFooter } from './components/analytics-ui'
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
 * Business Overview (P3): header → filters → recognition strip → primary
 * health KPIs (single staggered rise; per-card CountUp off) → comparison vs
 * previous period → sales trend → P&L (waterfall + component-once ledger) →
 * supporting economics (bridge + fulfillment, subordinate) → sales
 * breakdowns → drill-down → one meta footer. Every number traces to backend
 * meta (§6 auditability), empty-vs-zero honored everywhere (§6).
 */
export default function BusinessOverview() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const { data, isLoading, error, refetch } = useBusinessOverview(filters)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <AnalyticsPageHeader
        icon={Scale}
        title="Business Overview"
        subtitle="Recognised revenue only — Delivered is the recognition event."
        tileClassName="bg-success-soft text-success border-success/25"
      />

      <AnalyticsFilterBar value={filters} onChange={setFilters} />

      <WidgetShell
        title="Overview"
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <RecognitionStrip strip={data.data.pnl.strip} />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)}>
              <KpiCard title="Net Sales" kpi={data.data.pnl.lines.netSales} formulaVersion={data.meta.formulaVersion} animate={false} />
              <KpiCard title="Gross Profit" kpi={data.data.pnl.lines.grossProfit} formulaVersion={data.meta.formulaVersion} animate={false} />
              <KpiCard title="Contribution Profit" kpi={data.data.pnl.lines.contributionProfit} formulaVersion={data.meta.formulaVersion} animate={false} />
              <KpiCard title="Net Profit" kpi={data.data.pnl.lines.netProfit} formulaVersion={data.meta.formulaVersion} animate={false} />
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
                animate={false}
              />
              <KpiCard title="Cash Collected" kpi={data.data.pnl.lenses.cashCollected} formulaVersion={data.meta.formulaVersion} animate={false} />
            </div>

            <AnalyticsSection title="How this period compares" subtext="Versus the previous period.">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="kpi-card kpi-accent-info">
                  <CardContent className="pt-4">
                    <ComparisonDelta label="Net Sales" current={data.data.pnl.lines.netSales.value ?? 0} previous={data.data.comparison.prevNetSales} />
                  </CardContent>
                </Card>
                <Card className="kpi-card kpi-accent-info">
                  <CardContent className="pt-4">
                    <ComparisonDelta label="Recognised orders" current={data.data.pnl.strip.recognised} previous={data.data.comparison.prevRecognisedOrders} format={(v) => String(v)} />
                  </CardContent>
                </Card>
                <Card className="kpi-card kpi-accent-info">
                  <CardContent className="pt-4">
                    <ComparisonDelta label="Cash collected" current={data.data.pnl.lenses.cashCollected.value ?? 0} previous={data.data.comparison.prevCashCollected} />
                  </CardContent>
                </Card>
              </div>
            </AnalyticsSection>

            <TrendChart points={data.data.trend.points} granularity={data.data.trend.granularity} requestedGranularity={data.data.trend.requestedGranularity} />

            <AnalyticsSection title="From recognised revenue to Net Profit">
              <div className="space-y-4">
                <PnlWaterfall pnl={data.data.pnl} />
                <ComponentOnceLedger pnl={data.data.pnl} />
              </div>
            </AnalyticsSection>

            <AnalyticsSection title="Supporting economics" subtext="Delivery-axis diagnostics — not part of recognised revenue.">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ContributionBridge bridge={data.data.pnl.bridge} />
                <FulfillmentEconomicsPanel fulfillment={data.data.fulfillment} />
              </div>
            </AnalyticsSection>

            <AnalyticsSection title="Where sales come from">
              <Tabs defaultValue="channel">
                <TabsList className="tap-h max-w-full overflow-x-auto no-scrollbar">
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
            </AnalyticsSection>

            <DrilldownPanel filters={filters} currentPath="/mon/analytics" />

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
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
        )}
      </WidgetShell>
    </div>
  )
}
