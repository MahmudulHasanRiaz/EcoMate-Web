import { GitBranch } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { formatBDT, type BridgeData } from '../types'
import { InfoDisclosure, SectionHeader } from './analytics-ui'
import { INFO_FM_DIAGNOSTIC } from './info-copy'

/**
 * Single-count contribution bridge (§2.11, D12).
 *
 * Operands are EXACTLY Contribution Profit + Delivery Charge Retained.
 * Fulfillment Margin is a delivery-axis diagnostic — disclosed through the
 * info control, never rendered as an operand (Contribution Profit + FM would
 * subtract courierCost twice — mathematically forbidden, R15).
 */
export function ContributionBridge({ bridge }: { bridge: BridgeData }) {
  const dcrUnavailable = bridge.deliveryChargeRetainedState === 'unavailable'
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <SectionHeader
          icon={GitBranch}
          title="Contribution Bridge"
          tileClassName="bg-accent-violet-soft text-accent-violet border-accent-violet/25"
        />
      </CardHeader>
      <CardContent>
        <div data-testid="bridge-operands" className="divide-y divide-border/50">
          <div className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-sm text-muted-foreground">Contribution Profit</span>
            <span className="text-sm tabular-nums font-medium shrink-0">{formatBDT(bridge.contributionProfit)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-sm text-muted-foreground">+ Delivery Charge Retained</span>
            <span className="text-sm tabular-nums font-medium shrink-0">
              {dcrUnavailable ? 'Unavailable' : formatBDT(bridge.deliveryChargeRetained)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-sm font-bold">= Total Business Contribution</span>
            <span className="text-sm tabular-nums font-bold shrink-0">{formatBDT(bridge.totalBusinessContribution)}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-dashed pt-2">
          <span className="text-[11px] text-muted-foreground">
            Fulfillment Margin {formatBDT(bridge.fulfillmentMargin)}
          </span>
          <InfoDisclosure
            label="About Fulfillment Margin"
            lines={[INFO_FM_DIAGNOSTIC]}
            contentTestId="bridge-fm-diagnostic"
          />
        </div>
        {dcrUnavailable ? (
          <p className="text-[11px] text-muted-foreground mt-1">
            Delivery fee kept is missing for {bridge.codRecognisedOrders} cash-on-delivery order(s). Add a
            courier settlement to complete this number.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
