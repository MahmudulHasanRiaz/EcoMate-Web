import { ListChecks } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBDT, type OverviewData } from '../types'

/**
 * Component-once ledger (§2.11) — "Where each amount appears". Each component
 * appears in exactly one place; the ledger sums to Net Profit (R16).
 */
export function ComponentOnceLedger({ pnl }: { pnl: OverviewData['pnl'] }) {
  const { lines, bridge } = pnl
  const num = (v: number | null) => (v === null ? '—' : formatBDT(v))
  const rows: { component: string; sign: string; appearsIn: string; amount: number | null }[] = [
    { component: 'Gross Sales', sign: '+', appearsIn: 'Ladder', amount: lines.grossSales.value },
    { component: 'Discounts', sign: '−', appearsIn: 'Ladder', amount: lines.discounts.value },
    { component: 'Returns', sign: '−', appearsIn: 'Ladder', amount: lines.returns.value },
    { component: 'Refunds (reversal)', sign: '−', appearsIn: 'Ladder', amount: lines.refundsReversal.value },
    { component: 'Delivery Charge Retained', sign: '+', appearsIn: 'Bridge only', amount: bridge.deliveryChargeRetainedState === 'unavailable' ? null : bridge.deliveryChargeRetained },
    { component: 'COGS', sign: '−', appearsIn: 'Ladder', amount: lines.cogs.value },
    { component: 'Courier Cost', sign: '−', appearsIn: 'Ladder once (Fulfillment Cost line)', amount: lines.fulfillmentCost.value },
    { component: 'Payment Gateway Cost', sign: '−', appearsIn: 'Ladder', amount: lines.paymentFees.value },
    { component: 'Marketing Cost', sign: '−', appearsIn: 'Ladder', amount: lines.marketingCost.value },
    { component: 'Operating Expenses', sign: '−', appearsIn: 'Ladder', amount: lines.operatingExpenses.value },
    { component: 'Other Costs', sign: 'n/a', appearsIn: 'Ladder (—)', amount: null },
  ]
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-accent-violet-soft text-accent-violet border border-accent-violet/25">
            <ListChecks className="h-4 w-4" />
          </span>
          <CardTitle className="text-sm font-medium">Where Each Amount Appears</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
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
              <TableCell className="text-sm text-right tabular-nums font-bold">
                {lines.netProfit.value === null ? 'Unavailable' : formatBDT(lines.netProfit.value)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
