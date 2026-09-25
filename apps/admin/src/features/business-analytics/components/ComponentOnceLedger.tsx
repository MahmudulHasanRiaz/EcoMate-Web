import { ListChecks } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBDT, type OverviewData } from '../types'
import { SectionHeader } from './analytics-ui'

/**
 * Component-once ledger (§2.11) — "Where each amount appears". Each component
 * appears in exactly one place; the ledger sums to Net Profit (R16).
 *
 * Collapsed by default: the Net Profit row stays visible as the <summary>;
 * the full table is one tap away. Horizontally scrollable on narrow screens.
 */
export function ComponentOnceLedger({ pnl }: { pnl: OverviewData['pnl'] }) {
  const { lines, bridge } = pnl
  const num = (v: number | null) => (v === null ? '—' : formatBDT(v))
  const netProfit = lines.netProfit.value === null ? 'Unavailable' : formatBDT(lines.netProfit.value)
  const rows: { component: string; sign: string; appearsIn: string; amount: number | null }[] = [
    { component: 'Gross Sales', sign: '+', appearsIn: 'Profit steps', amount: lines.grossSales.value },
    { component: 'Discounts', sign: '−', appearsIn: 'Profit steps', amount: lines.discounts.value },
    { component: 'Returns', sign: '−', appearsIn: 'Profit steps', amount: lines.returns.value },
    { component: 'Refunds (reversal)', sign: '−', appearsIn: 'Profit steps', amount: lines.refundsReversal.value },
    { component: 'Delivery Charge Retained', sign: '+', appearsIn: 'Bridge only', amount: bridge.deliveryChargeRetainedState === 'unavailable' ? null : bridge.deliveryChargeRetained },
    { component: 'COGS', sign: '−', appearsIn: 'Profit steps', amount: lines.cogs.value },
    { component: 'Courier Cost', sign: '−', appearsIn: 'Profit steps once (Delivery Cost line)', amount: lines.fulfillmentCost.value },
    { component: 'Payment Gateway Cost', sign: '−', appearsIn: 'Profit steps', amount: lines.paymentFees.value },
    { component: 'Marketing Cost', sign: '−', appearsIn: 'Profit steps', amount: lines.marketingCost.value },
    { component: 'Operating Expenses', sign: '−', appearsIn: 'Profit steps', amount: lines.operatingExpenses.value },
    { component: 'Other Costs', sign: 'n/a', appearsIn: 'Profit steps (—)', amount: null },
  ]
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <SectionHeader
          icon={ListChecks}
          title="Where Each Amount Appears"
          tileClassName="bg-accent-violet-soft text-accent-violet border-accent-violet/25"
        />
      </CardHeader>
      <CardContent>
        <details data-testid="component-ledger">
          <summary className="-mx-2 flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-muted/40">
            <span className="text-sm font-bold">= Net Profit</span>
            <span className="shrink-0 text-sm font-bold tabular-nums">{netProfit}</span>
          </summary>
          <div className="overflow-x-auto">
            <Table className="dash-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Sign</TableHead>
                  <TableHead>Appears in</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.component}>
                    <TableCell className="text-sm">{r.component}</TableCell>
                    <TableCell className="text-sm">{r.sign}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.appearsIn}</TableCell>
                    <TableCell className="text-sm text-right tabular-nums">{num(r.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-sm font-bold" colSpan={3}>
                    = Net Profit
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums font-bold">{netProfit}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
