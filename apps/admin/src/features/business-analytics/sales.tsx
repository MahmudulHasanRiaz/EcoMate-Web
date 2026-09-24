'use client'

import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { riseStyle } from '@/components/ui/dashboard'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useSalesSettlement, useSalesSummary } from './hooks'
import { DEFAULT_FILTERS, formatBDT, formatPct, type AnalyticsFilters } from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { KpiCard } from './components/KpiCard'
import { RecognitionStrip } from './components/RecognitionStrip'
import { SalesTrendChart } from './components/SalesTrendChart'
import { FunnelPanel } from './components/FunnelPanel'
import { PipelinePanel } from './components/PipelinePanel'
import { SettlementTable } from './components/SettlementTable'
import { FulfillmentEconomicsPanel } from './components/FulfillmentEconomicsPanel'
import { BreakdownTable } from './components/BreakdownTable'
import { DrilldownPanel, type DrilldownItem } from './components/DrilldownPanel'

export const SALES_DRILLDOWN: DrilldownItem[] = [
  { label: 'Gross Sales → Net Sales → breakdown → orders', description: 'Recognised cohort down to contributing orders', to: '/op/orders', params: { deliveryOutcome: 'delivered' } },
  { label: 'Not-yet-recognised pipeline → pre-delivery orders', description: 'Pipeline stages down to orders', to: '/op/orders', params: { deliveryOutcome: 'in_fulfilment' } },
  { label: 'Return Loss → return events → order → courier cost', description: 'Delivered-then-returned orders with inference disclosure', to: '/op/orders', params: { deliveryOutcome: 'returned' } },
  { label: 'Settlement gap → COD orders pending settlement', description: 'Dispatch list for collection-unavailable orders', to: '/op/dispatch', params: { collectionStatus: 'cod-unavailable' } },
  { label: 'Fulfillment Margin → recognised-revenue ladder', description: 'Courier cost appears once in the P&L Fulfillment Cost line', to: '/mon/analytics', params: { view: 'ladder' } },
]

const COUNT_FORMAT = (v: number) => v.toLocaleString('en-US')

/**
 * Sales & Orders (P5): Booked vs Recognised vs Cash trio + three trends,
 * order metrics (AOV on recognised), funnel (unsupported "Not instrumented"),
 * payment / cancellation / return / refund breakdowns, pre-delivery pipeline,
 * and the FULL Fulfillment Economics panel (per-order settlement table +
 * inference column + coverage + gap banner). Drill-down follows §4.2 sales
 * rows — every link propagates the current filter params.
 */
export default function SalesAnalytics() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const { data, isLoading, error, refetch } = useSalesSummary(filters)
  const settlement = useSalesSettlement(filters, page, pageSize)

  const onFilters = (n: AnalyticsFilters) => {
    setFilters(n)
    setPage(1)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">Sales & Orders</h1>
            <p className="text-xs text-muted-foreground">Booked (intake) · Recognised (Delivered — the P&L basis) · Cash collected — three bases, never mixed.</p>
          </div>
        </div>
      </div>

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Sales & Orders"
        description={data ? `Formula ${data.meta.formulaVersion} · data as of ${data.meta.dataAsOf}` : undefined}
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <RecognitionStrip strip={data.data.strip} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)} data-testid="lens-trio">
              <KpiCard title="Booked (L1)" kpi={data.data.lenses.booked} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Recognised (L2)" kpi={data.data.lenses.recognised} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Cash Collected (L3)" kpi={data.data.lenses.cashCollected} formulaVersion={data.meta.formulaVersion} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-rise" style={riseStyle(1)}>
              <KpiCard title="Booked Orders" kpi={data.data.orderMetrics.bookedOrders} format={COUNT_FORMAT} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Booked Value" kpi={data.data.orderMetrics.bookedValue} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Recognised Orders" kpi={data.data.orderMetrics.recognisedOrders} format={COUNT_FORMAT} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Recognised Value" kpi={data.data.orderMetrics.recognisedValue} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="AOV (Recognised)" kpi={data.data.orderMetrics.aovRecognised} formulaVersion={data.meta.formulaVersion} />
              <KpiCard title="Units Recognised" kpi={data.data.orderMetrics.unitsRecognised} format={COUNT_FORMAT} formulaVersion={data.meta.formulaVersion} />
            </div>

            <SalesTrendChart
              booked={data.data.trends.booked}
              recognised={data.data.trends.recognised}
              cash={data.data.trends.cash}
              granularity={data.data.trends.granularity}
              requestedGranularity={data.data.trends.requestedGranularity}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-rise" style={riseStyle(2)}>
              <FunnelPanel stages={data.data.funnel} />
              <PipelinePanel stages={data.data.pipeline.stages} totalOrders={data.data.pipeline.totalOrders} totalValue={data.data.pipeline.totalValue} />
            </div>

            <Tabs defaultValue="payment" className="animate-rise" style={riseStyle(3)}>
              <TabsList className="tap-h">
                <TabsTrigger value="payment" className="tap-h">Payment Methods</TabsTrigger>
                <TabsTrigger value="cancel" className="tap-h">Cancellations</TabsTrigger>
                <TabsTrigger value="return" className="tap-h">Returns</TabsTrigger>
                <TabsTrigger value="refund" className="tap-h">Refunds</TabsTrigger>
              </TabsList>
              <TabsContent value="payment">
                <BreakdownTable
                  title="Cash by Payment Method (PAID only)"
                  rows={data.data.paymentBreakdown.methods.map((m) => ({ key: m.gateway, label: m.gateway, netSales: m.amount, orders: m.orders }))}
                  hint="Orders with ≥1 PAID payment of this method — multi-payment orders match multiple methods. Unpaid intake orders are excluded from the rows."
                />
                <p className="text-[11px] text-muted-foreground mt-2">
                  No PAID payment: {data.data.paymentBreakdown.unpaid.orders} order(s) · {formatBDT(data.data.paymentBreakdown.unpaid.bookedValue)} intake value. {data.data.paymentBreakdown.unpaid.note}
                </p>
              </TabsContent>
              <TabsContent value="cancel">
                <BreakdownTable
                  title="Cancellations by Prior Stage"
                  rows={data.data.cancellations.byPriorStage.map((s) => ({ key: s.stage, label: s.stage, netSales: s.value, orders: s.orders }))}
                  hint={data.data.cancellations.dateBasis}
                />
                <p className="text-[11px] text-muted-foreground mt-2">
                  {data.data.cancellations.total} cancelled · {formatBDT(data.data.cancellations.totalValue)} intake value · {data.data.cancellations.undated} undated (counted, never dated).
                </p>
              </TabsContent>
              <TabsContent value="return">
                <Card className="chart-card rounded-2xl">
                  <CardContent className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Return Events</p>
                      <p className="text-lg font-bold tabular-nums text-danger">{data.data.returns.events}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Returned Value</p>
                      <p className="text-lg font-bold tabular-nums text-danger">{formatBDT(data.data.returns.value)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Returned Units</p>
                      <p className="text-lg font-bold tabular-nums text-danger">{data.data.returns.units.toLocaleString('en-US')}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground">Return Rate (order-level)</p>
                      <p className="text-lg font-bold tabular-nums text-danger">{formatPct(data.data.returns.rate)}</p>
                    </div>
                  </CardContent>
                </Card>
                <p className="text-[11px] text-muted-foreground mt-2">
                  {data.data.returns.rateBasis} · {data.data.returns.dateBasis} · COGS reversal {formatBDT(data.data.returns.cogsReversal)}
                  {data.data.returns.cogsUnavailableUnits > 0 ? ` · ${data.data.returns.cogsUnavailableUnits} unit(s) without costSnapshot (never back-filled)` : ''}.
                </p>
              </TabsContent>
              <TabsContent value="refund">
                <BreakdownTable
                  title="Refunds by Crossover Class (D7)"
                  rows={[
                    { key: 'reversal', label: 'Revenue reversal (delivered, not returned)', netSales: data.data.refunds.reversal.amount, orders: data.data.refunds.reversal.orders },
                    { key: 'informational', label: 'Informational (delivered + returned)', netSales: data.data.refunds.informational.amount, orders: data.data.refunds.informational.orders },
                    { key: 'not_a_reversal', label: 'Not a reversal (never delivered)', netSales: data.data.refunds.not_a_reversal.amount, orders: data.data.refunds.not_a_reversal.orders },
                  ]}
                  hint={data.data.refunds.dateBasis}
                />
                <p className="text-[11px] text-muted-foreground mt-2">{data.data.refunds.crossoverNote}</p>
              </TabsContent>
            </Tabs>

            <FulfillmentEconomicsPanel fulfillment={data.data.economics.fulfillment} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-rise" style={riseStyle(4)}>
              <Card className="kpi-card kpi-accent-danger">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Return Loss (online return events)</p>
                  <p className="kpi-value">{formatBDT(data.data.economics.returnLoss.amount)}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Σ(courierCost − deliveryChargeRetained) over {data.data.economics.returnLoss.events} event(s)
                    {data.data.economics.returnLoss.unavailableEvents > 0 ? ` · ${data.data.economics.returnLoss.unavailableEvents} event(s) unavailable` : ''}.{' '}
                    {data.data.economics.returnLoss.note}
                  </p>
                </CardContent>
              </Card>
              <Card className="kpi-card kpi-accent-warning">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Refund Leakage (never-delivered)</p>
                  <p className="kpi-value">{formatBDT(data.data.economics.refundLeakage.amount)}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {data.data.economics.refundLeakage.refunds} refund(s) on {data.data.economics.refundLeakage.orders} order(s).{' '}
                    {data.data.economics.refundLeakage.note}
                  </p>
                </CardContent>
              </Card>
            </div>

            {settlement.data ? (
              <SettlementTable
                rows={settlement.data.data.rows}
                total={settlement.data.data.total}
                page={settlement.data.data.page}
                pageSize={settlement.data.data.pageSize}
                totalPages={settlement.data.data.totalPages}
                gapBanner={settlement.data.data.gapBanner}
                panelNote={settlement.data.data.panelNote}
                onPageChange={(p) => setPage(p)}
              />
            ) : settlement.isLoading ? (
              <Skeleton className="h-[300px] w-full rounded-lg" />
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">No data</div>
            )}

            <DrilldownPanel filters={filters} items={SALES_DRILLDOWN} />

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
