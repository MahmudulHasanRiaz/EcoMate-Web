import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBDT, type BridgeData } from '../types'

/**
 * Single-count contribution bridge (§2.11, D12).
 *
 * Operands are EXACTLY Contribution Profit + Delivery Charge Retained.
 * Fulfillment Margin is a delivery-axis diagnostic — rendered as a caption,
 * never as an operand (Contribution Profit + FM would subtract courierCost
 * twice — mathematically forbidden, R15).
 */
export function ContributionBridge({ bridge }: { bridge: BridgeData }) {
  const dcrUnavailable = bridge.deliveryChargeRetainedState === 'unavailable'
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Contribution Bridge</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="bridge-operands" className="divide-y divide-border/50">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted-foreground">Contribution Profit</span>
            <span className="text-sm tabular-nums font-medium">{formatBDT(bridge.contributionProfit)}</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted-foreground">+ Delivery Charge Retained</span>
            <span className="text-sm tabular-nums font-medium">
              {dcrUnavailable ? 'Unavailable' : formatBDT(bridge.deliveryChargeRetained)}
            </span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm font-bold">= Total Business Contribution</span>
            <span className="text-sm tabular-nums font-bold">{formatBDT(bridge.totalBusinessContribution)}</span>
          </div>
        </div>
        <p data-testid="bridge-fm-diagnostic" className="text-[11px] text-muted-foreground mt-2 border-t border-dashed pt-2">
          Fulfillment Margin {formatBDT(bridge.fulfillmentMargin)} is a diagnostic of the delivery axis — not an
          additive component of Total Business Contribution.
        </p>
        {dcrUnavailable ? (
          <p className="text-[11px] text-muted-foreground mt-1">
            Delivery Charge Retained is unavailable for {bridge.codRecognisedOrders} COD recognised order(s) — no
            courier settlement source yet.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
