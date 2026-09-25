import { AlertTriangle, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBDT, type FulfillmentCompact } from '../types'
import { MetricUnavailable } from './badges'
import { INFO_COURIER_COST_ONCE, INFO_FULFILLMENT_NOT_SALES, infoCodUnavailable } from './info-copy'
import { plainLine } from './info-copy'

/** COD gap banner: rendered exactly when codOrders > 0. */
export function SettlementGapBanner({ gapBanner }: { gapBanner: FulfillmentCompact['gapBanner'] }) {
  if (gapBanner.codOrders <= 0) return null
  return (
    <div role="alert" className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{plainLine(gapBanner.message)}</span>
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
            <p className="text-[11px] text-muted-foreground">{fulfillment.panelNote ? plainLine(fulfillment.panelNote) : INFO_FULFILLMENT_NOT_SALES}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <SettlementGapBanner gapBanner={fulfillment.gapBanner} />
        {hasCodGap ? (
          <div data-testid="cod-unavailable-note">
            <MetricUnavailable reason={infoCodUnavailable(coverage.codOrders)} compact />
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
          {INFO_COURIER_COST_ONCE} Online: {coverage.onlineOrders} · Cash on delivery:{' '}
          {coverage.codOrders}
        </p>
      </CardContent>
    </Card>
  )
}
