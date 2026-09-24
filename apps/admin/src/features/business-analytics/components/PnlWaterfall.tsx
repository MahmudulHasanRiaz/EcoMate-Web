import { ListOrdered } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBDT, type CostCoverage, type CostState, type OverviewData } from '../types'
import { CostStateBadge, DataCoverageBadge } from './badges'

interface LadderRow {
  label: string
  kpi: { value: number | null; state: string; reason?: string }
  state: CostState
  indent?: boolean
  result?: boolean
}

function missingCount(coverage: CostCoverage): number {
  return (
    coverage.cogs.unavailableItems +
    coverage.shipping.unavailableOrders +
    coverage.fees.withoutFee +
    coverage.marketing.undatedRows +
    coverage.delivery.collectionUnavailableOrders
  )
}

/**
 * P&L ladder (§2.5) with a CostStateBadge per line and the ladderState banner:
 * Net Profit renders "(estimated — see coverage)" / "(partial — N inputs
 * missing)" unless every input is actual. Operating == Net is stated in words
 * (Other Costs has no source — it renders "—", never a number).
 */
export function PnlWaterfall({ pnl }: { pnl: OverviewData['pnl'] }) {
  const { lines, coverage } = pnl
  const missing = missingCount(coverage)

  const rows: LadderRow[] = [
    { label: 'Gross Sales', kpi: lines.grossSales, state: 'actual' },
    { label: '− Discounts', kpi: lines.discounts, state: 'actual', indent: true },
    { label: '− Returns', kpi: lines.returns, state: 'actual', indent: true },
    { label: '− Refunds (reversal)', kpi: lines.refundsReversal, state: 'actual', indent: true },
    { label: '= Net Sales', kpi: lines.netSales, state: 'actual', result: true },
    { label: '− COGS', kpi: lines.cogs, state: lines.cogs.state === 'ok' || lines.cogs.state === 'zero' ? 'actual' : (lines.cogs.state as CostState) },
    { label: '= Gross Profit', kpi: lines.grossProfit, state: lines.grossProfit.state === 'ok' || lines.grossProfit.state === 'zero' ? 'actual' : (lines.grossProfit.state as CostState), result: true },
    { label: '− Fulfillment Cost', kpi: lines.fulfillmentCost, state: lines.fulfillmentCost.state === 'ok' || lines.fulfillmentCost.state === 'zero' ? 'actual' : (lines.fulfillmentCost.state as CostState), indent: true },
    { label: '− Payment Gateway Cost', kpi: lines.paymentFees, state: lines.paymentFees.state === 'ok' || lines.paymentFees.state === 'zero' ? 'actual' : (lines.paymentFees.state as CostState), indent: true },
    { label: '− Marketing Cost', kpi: lines.marketingCost, state: lines.marketingCost.state === 'ok' || lines.marketingCost.state === 'zero' ? 'actual' : (lines.marketingCost.state as CostState), indent: true },
    { label: '= Contribution Profit', kpi: lines.contributionProfit, state: lines.contributionProfit.state === 'ok' || lines.contributionProfit.state === 'zero' ? 'actual' : (lines.contributionProfit.state as CostState), result: true },
    { label: '− Operating Expenses', kpi: lines.operatingExpenses, state: 'actual', indent: true },
    { label: '= Operating Profit', kpi: lines.operatingProfit, state: lines.operatingProfit.state === 'ok' || lines.operatingProfit.state === 'zero' ? 'actual' : (lines.operatingProfit.state as CostState), result: true },
    { label: '− Other Costs', kpi: lines.otherCosts, state: 'not_applicable', indent: true },
    { label: '= Net Profit', kpi: lines.netProfit, state: lines.netProfit.state === 'ok' || lines.netProfit.state === 'zero' ? 'actual' : (lines.netProfit.state as CostState), result: true },
  ]

  const netState = lines.netProfit.state
  const banner =
    netState === 'ok' || netState === 'zero' || netState === 'no_data'
      ? null
      : netState === 'estimated'
        ? 'Net Profit (estimated — see coverage)'
        : `Net Profit (partial — ${missing} inputs missing)`

  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
              <ListOrdered className="h-4 w-4" />
            </span>
            <CardTitle className="text-sm font-medium">Profit & Loss Waterfall</CardTitle>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <DataCoverageBadge missing={coverage.cogs.unavailableItems} label="COGS" title="Order items with no costSnapshot" />
            <DataCoverageBadge missing={coverage.shipping.unavailableOrders} label="Shipping cost" title="Recognised orders with shippingCost NULL" />
            <DataCoverageBadge missing={coverage.fees.withoutFee} label="Gateway fees" title="PAID payments with feeAmount NULL" />
            <DataCoverageBadge missing={coverage.marketing.undatedRows} label="Undated marketing spend" title="Consumptions with spendDate NULL — excluded from every period total" />
            <DataCoverageBadge missing={coverage.delivery.collectionUnavailableOrders} label="COD settlement" title="COD orders with unavailable collection" />
          </div>
        </div>
        {banner ? (
          <p className="text-xs font-bold text-warning" role="status">
            {banner}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/50">
          {rows.map((r) => (
            <div key={r.label} className={`flex items-center justify-between py-1.5 ${r.indent ? 'pl-4' : ''}`}>
              <span className={`text-sm ${r.result ? 'font-bold' : 'text-muted-foreground'}`}>{r.label}</span>
              <span className="flex items-center gap-2">
                <span className={`text-sm tabular-nums ${r.result ? 'font-bold' : ''} ${r.kpi.state === 'not_applicable' ? 'text-muted-foreground/60' : ''}`}>
                  {r.kpi.state === 'not_applicable' ? '—' : r.kpi.value === null ? 'Unavailable' : formatBDT(r.kpi.value)}
                </span>
                <CostStateBadge state={r.state} reason={r.kpi.reason} />
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Operating Profit equals Net Profit — Other Costs has no data source and renders "—".
        </p>
      </CardContent>
    </Card>
  )
}
