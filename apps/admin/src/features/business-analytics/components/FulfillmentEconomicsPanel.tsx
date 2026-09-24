import { AlertTriangle, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBDT, type FulfillmentCompact } from '../types'
import { MetricUnavailable } from './badges'

/** Verbatim COD gap banner (§2.10.2): rendered exactly when codOrders > 0. */
export function SettlementGapBanner({ gapBanner }: { gapBanner: FulfillmentCompact['gapBanner'] }) {
  if (gapBanner.codOrders <= 0) return null
  return (
    <div role="alert" className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{gapBanner.message}</span>
    </div>
  )
}

/**
 * Compact Fulfillment & Returns Economics card (§2.10 placement: compact card
 * on Overview; the full per-order panel is P5 on Sales & Orders).
 *
 * "Not part of recognised revenue". When COD orders exist, collected /
 * retained / margin are online-orders-only and labelled as such — COD figures
 * are unavailable until a courier settlement source exists (D11).
 */
export function FulfillmentEconomicsPanel({ fulfillment }: { fulfillment: FulfillmentCompact }) {
  const { totals, coverage } = fulfillment
  const hasCodGap = coverage.codOrders > 0
  const stat = (label: string, value: number, onlineOnly?: boolean) => (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{formatBDT(value)}</p>
      {onlineOnly ? <p className="text-[11px] text-muted-foreground">online orders only</p> : null}
    </div>
  )
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
            <Truck className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-sm font-medium">Fulfillment & Returns Economics</CardTitle>
            <p className="text-[11px] text-muted-foreground">{fulfillment.panelNote || 'Not part of recognised revenue.'}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <SettlementGapBanner gapBanner={fulfillment.gapBanner} />
        {hasCodGap ? (
          <div data-testid="cod-unavailable-note">
            <MetricUnavailable reason={`Collection, retained amount and fulfillment margin are unavailable for ${coverage.codOrders} COD order(s). A courier settlement import will supply this.`} compact />
          </div>
        ) : null}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stat('Total Collected', totals.collected, hasCodGap)}
          {stat('Total Refunded', totals.refunded)}
          {stat('Total Retained', totals.retained, hasCodGap)}
          {stat('Total Courier Cost', totals.courierCost)}
          {stat('Delivery Charge Retained', totals.deliveryChargeRetained, hasCodGap)}
          {stat('Fulfillment Margin', totals.fulfillmentMargin, hasCodGap)}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Courier cost is the same underlying cost shown once in the P&L Fulfillment Cost line. Coverage — online:{' '}
          {coverage.onlineOrders} · COD: {coverage.codOrders}
        </p>
      </CardContent>
    </Card>
  )
}
