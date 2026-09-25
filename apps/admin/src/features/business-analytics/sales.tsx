'use client'

import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { riseStyle } from '@/components/ui/dashboard'
import { WidgetShell } from '../dashboard/components/WidgetShell'
import { useSalesSettlement, useSalesSummary } from './hooks'
import { DEFAULT_FILTERS, formatBDT, formatPct, type AnalyticsFilters, type SalesSummaryData } from './types'
import { AnalyticsFilterBar } from './components/AnalyticsFilterBar'
import { AnalyticsPageHeader, AnalyticsSection, InfoDisclosure, MetricMetaFooter } from './components/analytics-ui'
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
 * Order volume in range — counts only. Money lives in the lens trio above,
 * so Booked/Recognised Value never repeat here (W2 triple-count kill).
 */
export function OrderCountsBand({
  orderMetrics,
  formulaVersion,
}: {
  orderMetrics: SalesSummaryData['orderMetrics']
  formulaVersion: string
}) {
  return (
    <AnalyticsSection title="Order volume in range" subtext="Counts and average — money lives in the lens cards above.">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="order-counts">
        <KpiCard title="Booked Orders" kpi={orderMetrics.bookedOrders} format={COUNT_FORMAT} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Recognised Orders" kpi={orderMetrics.recognisedOrders} format={COUNT_FORMAT} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="Units Recognised" kpi={orderMetrics.unitsRecognised} format={COUNT_FORMAT} formulaVersion={formulaVersion} animate={false} />
        <KpiCard title="AOV (Recognised)" kpi={orderMetrics.aovRecognised} formulaVersion={formulaVersion} animate={false} />
      </div>
    </AnalyticsSection>
  )
}

/** Returns tab — the four return stats as KpiCards (one idiom), notes in disclosure. */
export function ReturnsBand({ returns }: { returns: SalesSummaryData['returns'] }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="returns-band">
        <KpiCard
          title="Return Events"
          kpi={{ value: returns.events, state: 'ok', reason: 'Delivered-then-returned order events in range', dateBasis: returns.dateBasis }}
          format={COUNT_FORMAT}
          animate={false}
        />
        <KpiCard
          title="Returned Value"
          kpi={{ value: returns.value, state: 'ok', reason: 'Returned intake value', dateBasis: returns.dateBasis }}
          animate={false}
        />
        <KpiCard
          title="Returned Units"
          kpi={{ value: returns.units, state: 'ok', reason: 'Returned units in range', dateBasis: returns.dateBasis }}
          format={COUNT_FORMAT}
          animate={false}
        />
        <KpiCard
          title="Return Rate (order-level)"
          kpi={{ value: returns.rate, state: returns.rate === null ? 'no_data' : 'ok', reason: returns.rateBasis, dateBasis: returns.dateBasis }}
          format={(v) => formatPct(v)}
          animate={false}
        />
      </div>
      <InfoDisclosure
        label="About returns"
        lines={[
          returns.rateBasis,
          returns.dateBasis,
          `COGS reversal ${formatBDT(returns.cogsReversal)}${returns.cogsUnavailableUnits > 0 ? ` · ${returns.cogsUnavailableUnits} unit(s) without costSnapshot (never back-filled)` : ''}`,
        ]}
        contentTestId="returns-notes"
      />
    </div>
  )
}

/**
 * Supporting economics — the full fulfillment panel plus Return Loss and
 * Refund Leakage as subordinate KpiCards (same idiom, reduced weight).
 * Every note lives in the card disclosure, never a visible caption.
 */
export function EconAftermath({ economics }: { economics: SalesSummaryData['economics'] }) {
  const { returnLoss, refundLeakage } = economics
  return (
    <AnalyticsSection title="Supporting economics" subtext="Delivery-axis diagnostics — not part of recognised revenue.">
      <div className="space-y-4">
        <FulfillmentEconomicsPanel fulfillment={economics.fulfillment} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="econ-aftermath">
          <KpiCard
            title="Return Loss (online return events)"
            kpi={{
              value: returnLoss.amount,
              state: 'ok',
              reason: `Σ(courierCost − deliveryChargeRetained) over ${returnLoss.events} event(s)${returnLoss.unavailableEvents > 0 ? ` · ${returnLoss.unavailableEvents} event(s) unavailable` : ''}. ${returnLoss.note}`,
            }}
            animate={false}
          />
          <KpiCard
            title="Refund Leakage (never-delivered)"
            kpi={{
              value: refundLeakage.amount,
              state: 'ok',
              reason: `${refundLeakage.refunds} refund(s) on ${refundLeakage.orders} order(s). ${refundLeakage.note}`,
            }}
            animate={false}
          />
        </div>
      </div>
    </AnalyticsSection>
  )
}

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
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <AnalyticsPageHeader
        icon={ShoppingCart}
        title="Sales & Orders"
        subtitle="Booked (intake) · Recognised (Delivered — the P&L basis) · Cash collected — three bases, never mixed."
        tileClassName="bg-success-soft text-success border-success/25"
      />

      <AnalyticsFilterBar value={filters} onChange={onFilters} />

      <WidgetShell
        title="Sales & Orders"
        isLoading={isLoading}
        error={error as Error | undefined}
        onRetry={() => refetch()}
      >
        {data ? (
          <div className="space-y-6">
            <RecognitionStrip strip={data.data.strip} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-rise" style={riseStyle(0)} data-testid="lens-trio">
              <KpiCard title="Booked (L1)" kpi={data.data.lenses.booked} formulaVersion={data.meta.formulaVersion} animate={false} />
              <KpiCard title="Recognised (L2)" kpi={data.data.lenses.recognised} formulaVersion={data.meta.formulaVersion} animate={false} />
              <KpiCard title="Cash Collected (L3)" kpi={data.data.lenses.cashCollected} formulaVersion={data.meta.formulaVersion} animate={false} />
            </div>

            <div className="animate-rise" style={riseStyle(1)}>
              <OrderCountsBand orderMetrics={data.data.orderMetrics} formulaVersion={data.meta.formulaVersion} />
            </div>

            <SalesTrendChart
              booked={data.data.trends.booked}
              recognised={data.data.trends.recognised}
              cash={data.data.trends.cash}
              granularity={data.data.trends.granularity}
              requestedGranularity={data.data.trends.requestedGranularity}
            />

            <AnalyticsSection title="Where booked intake goes" subtext="Intake cohort reaching each stage — pipeline is not revenue.">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-rise" style={riseStyle(2)}>
                <FunnelPanel stages={data.data.funnel} />
                <PipelinePanel stages={data.data.pipeline.stages} totalOrders={data.data.pipeline.totalOrders} totalValue={data.data.pipeline.totalValue} />
              </div>
            </AnalyticsSection>

            <AnalyticsSection title="How orders end" subtext="Cash, cancellations, returns and refunds — same intake cohort, different endings.">
              <Tabs defaultValue="payment" className="animate-rise" style={riseStyle(3)}>
                <TabsList className="tap-h max-w-full overflow-x-auto no-scrollbar">
                  <TabsTrigger value="payment" className="tap-h">Payment Methods</TabsTrigger>
                  <TabsTrigger value="cancel" className="tap-h">Cancellations</TabsTrigger>
                  <TabsTrigger value="return" className="tap-h">Returns</TabsTrigger>
                  <TabsTrigger value="refund" className="tap-h">Refunds</TabsTrigger>
                </TabsList>
                <TabsContent value="payment">
                  <div className="space-y-2">
                    <BreakdownTable
                      title="Cash by Payment Method (PAID only)"
                      rows={data.data.paymentBreakdown.methods.map((m) => ({ key: m.gateway, label: m.gateway, netSales: m.amount, orders: m.orders }))}
                      hint="Orders with ≥1 PAID payment of this method — multi-payment orders match multiple methods. Unpaid intake orders are excluded from the rows."
                    />
                    <InfoDisclosure
                      label="About unpaid intake"
                      lines={[
                        `No PAID payment: ${data.data.paymentBreakdown.unpaid.orders} order(s) · ${formatBDT(data.data.paymentBreakdown.unpaid.bookedValue)} intake value.`,
                        data.data.paymentBreakdown.unpaid.note,
                      ]}
                      contentTestId="unpaid-notes"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="cancel">
                  <div className="space-y-2">
                    <BreakdownTable
                      title="Cancellations by Prior Stage"
                      rows={data.data.cancellations.byPriorStage.map((s) => ({ key: s.stage, label: s.stage, netSales: s.value, orders: s.orders }))}
                      hint={data.data.cancellations.dateBasis}
                    />
                    <InfoDisclosure
                      label="About cancellations"
                      lines={[
                        `${data.data.cancellations.total} cancelled · ${formatBDT(data.data.cancellations.totalValue)} intake value · ${data.data.cancellations.undated} undated (counted, never dated).`,
                      ]}
                      contentTestId="cancel-notes"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="return">
                  <ReturnsBand returns={data.data.returns} />
                </TabsContent>
                <TabsContent value="refund">
                  <div className="space-y-2">
                    <BreakdownTable
                      title="Refunds by Crossover Class (D7)"
                      rows={[
                        { key: 'reversal', label: 'Revenue reversal (delivered, not returned)', netSales: data.data.refunds.reversal.amount, orders: data.data.refunds.reversal.orders },
                        { key: 'informational', label: 'Informational (delivered + returned)', netSales: data.data.refunds.informational.amount, orders: data.data.refunds.informational.orders },
                        { key: 'not_a_reversal', label: 'Not a reversal (never delivered)', netSales: data.data.refunds.not_a_reversal.amount, orders: data.data.refunds.not_a_reversal.orders },
                      ]}
                      hint={data.data.refunds.dateBasis}
                    />
                    <InfoDisclosure
                      label="About refunds"
                      lines={[data.data.refunds.crossoverNote]}
                      contentTestId="refund-notes"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </AnalyticsSection>

            <EconAftermath economics={data.data.economics} />

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
