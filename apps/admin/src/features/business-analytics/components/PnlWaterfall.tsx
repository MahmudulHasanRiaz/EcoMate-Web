import { ListOrdered } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { formatBDT, type CostCoverage, type CostState, type OverviewData } from '../types'
import { CostStateBadge, DataCoverageBadge } from './badges'
import { SectionHeader } from './analytics-ui'
import { INFO_MISSING_COST_ACTION, INFO_UNDATED_SPEND_ACTION, infoCodUnavailable } from './info-copy'

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

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function RowView({ r, inSummary }: { r: LadderRow; inSummary?: boolean }) {
  // <summary> permits phrasing content only — render the result row as a span
  // there, a div everywhere else. Identical visuals either way.
  const Tag = inSummary ? 'span' : 'div'
  return (
    <Tag className={`flex items-center justify-between gap-2 py-1.5 ${r.indent ? 'pl-4' : ''}`}>
      <span className={`min-w-0 text-sm ${r.result ? 'font-bold' : 'text-muted-foreground'}`}>{r.label}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
        <span
          className={`text-sm tabular-nums ${r.result ? 'font-bold' : ''} ${r.kpi.state === 'not_applicable' ? 'text-muted-foreground/60' : ''}`}
        >
          {r.kpi.state === 'not_applicable' ? '—' : r.kpi.value === null ? 'Unavailable' : formatBDT(r.kpi.value)}
        </span>
        <CostStateBadge state={r.state} reason={r.kpi.reason} />
      </span>
    </Tag>
  )
}

/**
 * P&L ladder (§2.5) with a CostStateBadge per line and the ladderState banner:
 * Net Profit renders "(estimated — see coverage)" / "(partial — N inputs
 * missing)" unless every input is actual. Operating == Net is stated in words
 * (Other Costs has no source — it renders "—", never a number).
 *
 * Result groups are collapsible ladders (open by default): every result row
 * stays visible as the <summary>; collapsing hides components only, never a
 * result or its badge.
 */
export function PnlWaterfall({ pnl }: { pnl: OverviewData['pnl'] }) {
  const { lines, coverage } = pnl
  const missing = missingCount(coverage)

  const cost = (k: { state: string }): CostState =>
    k.state === 'ok' || k.state === 'zero' ? 'actual' : (k.state as CostState)

  const groups: { result: LadderRow; rows: LadderRow[] }[] = [
    {
      result: { label: '= Net Sales', kpi: lines.netSales, state: 'actual', result: true },
      rows: [
        { label: 'Gross Sales', kpi: lines.grossSales, state: 'actual' },
        { label: '− Discounts', kpi: lines.discounts, state: 'actual', indent: true },
        { label: '− Returns', kpi: lines.returns, state: 'actual', indent: true },
        { label: '− Refunds (reversal)', kpi: lines.refundsReversal, state: 'actual', indent: true },
      ],
    },
    {
      result: { label: '= Gross Profit', kpi: lines.grossProfit, state: cost(lines.grossProfit), result: true },
      rows: [{ label: '− COGS', kpi: lines.cogs, state: cost(lines.cogs), indent: true }],
    },
    {
      result: {
        label: '= Contribution Profit',
        kpi: lines.contributionProfit,
        state: cost(lines.contributionProfit),
        result: true,
      },
      rows: [
        { label: '− Fulfillment Cost', kpi: lines.fulfillmentCost, state: cost(lines.fulfillmentCost), indent: true },
        { label: '− Payment Gateway Cost', kpi: lines.paymentFees, state: cost(lines.paymentFees), indent: true },
        { label: '− Marketing Cost', kpi: lines.marketingCost, state: cost(lines.marketingCost), indent: true },
      ],
    },
    {
      result: {
        label: '= Operating Profit',
        kpi: lines.operatingProfit,
        state: cost(lines.operatingProfit),
        result: true,
      },
      rows: [{ label: '− Operating Expenses', kpi: lines.operatingExpenses, state: 'actual', indent: true }],
    },
    {
      result: { label: '= Net Profit', kpi: lines.netProfit, state: cost(lines.netProfit), result: true },
      rows: [{ label: '− Other Costs', kpi: lines.otherCosts, state: 'not_applicable', indent: true }],
    },
  ]

  const netState = lines.netProfit.state
  const banner =
    netState === 'ok' || netState === 'zero' || netState === 'no_data'
      ? null
      : netState === 'estimated'
        ? 'Net Profit is estimated — some costs are missing. See missing items above.'
        : `Net Profit is partial — ${missing} cost(s) are missing. See missing items above.`

  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <SectionHeader
          icon={ListOrdered}
          title="Profit & Loss Waterfall"
          tileClassName="bg-success-soft text-success border-success/25"
          action={
            <>
              <DataCoverageBadge
                missing={coverage.cogs.unavailableItems}
                label="COGS"
                title={INFO_MISSING_COST_ACTION}
                href="/mon/analytics/products"
              />
              <DataCoverageBadge
                missing={coverage.shipping.unavailableOrders}
                label="Shipping cost"
                title="No delivery cost was entered for these orders. Add it on the order to complete this number."
                href="/mon/analytics/sales"
              />
              <DataCoverageBadge
                missing={coverage.fees.withoutFee}
                label="Gateway fees"
                title="No gateway fee was entered for these paid orders. Add it on the payment to complete this number."
                href="/mon/analytics/sales"
              />
              <DataCoverageBadge
                missing={coverage.marketing.undatedRows}
                label="Undated marketing spend"
                title={INFO_UNDATED_SPEND_ACTION}
                href="/mon/analytics/marketing#marketing-undated-fixlist"
              />
              <DataCoverageBadge
                missing={coverage.delivery.collectionUnavailableOrders}
                label="COD settlement"
                title={infoCodUnavailable(coverage.delivery.collectionUnavailableOrders)}
                href="/mon/analytics/sales"
              />
            </>
          }
        />
        {banner ? (
          <p className="text-xs font-bold text-warning" role="alert">
            {banner}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/50">
          {groups.map((g) => (
            <details key={g.result.label} open data-testid={`pnl-group-${slug(g.result.label)}`}>
              <summary className="-mx-2 cursor-pointer rounded-lg px-2 transition-colors duration-150 hover:bg-muted/40">
                <RowView r={g.result} inSummary />
              </summary>
              <div>
                {g.rows.map((r) => (
                  <RowView key={r.label} r={r} />
                ))}
              </div>
            </details>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Operating Profit equals Net Profit. There is no Other Costs list, so it shows —.
        </p>
      </CardContent>
    </Card>
  )
}
