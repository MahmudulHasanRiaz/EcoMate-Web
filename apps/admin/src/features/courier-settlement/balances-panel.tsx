import { Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CountUp, riseStyle } from '@/components/ui/dashboard'
import { cn } from '@/lib/utils'
import { useBalances } from './hooks'

const bdt = (v: number) =>
  `৳${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Kpi({
  title,
  value,
  hint,
  accent,
}: {
  title: string
  value: number
  hint?: string
  accent?: 'kpi-accent-warning' | 'kpi-accent-info' | 'kpi-accent-danger' | 'kpi-accent-success'
}) {
  return (
    <Card className={cn('kpi-card', accent ?? 'kpi-accent-info')}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="kpi-value">
          <CountUp value={value} format={bdt} />
        </div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/**
 * Balances (§3): COD outstanding per order, buckets, and what we owe the
 * courier. Figures come from finalized settlement rows only — an order with no
 * settlement document shows as "not yet collected", never a guessed zero.
 */
export function BalancesPanel() {
  const { data, isLoading } = useBalances()
  const kpis = data?.kpis
  const buckets = data?.buckets
  const orders = data?.orders ?? []

  if (isLoading) {
    return <div className="py-10 text-center text-muted-foreground">Loading balances…</div>
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3 animate-rise" style={riseStyle(0)}>
        <Kpi
          title="COD outstanding"
          value={kpis?.outstandingCod ?? 0}
          hint="Cash we have not received yet"
          accent="kpi-accent-warning"
        />
        <Kpi
          title="Awaiting settlement"
          value={kpis?.awaitingSettlement ?? 0}
          hint="COD not yet backed by a finalized invoice"
          accent="kpi-accent-info"
        />
        <Kpi
          title="Payable to courier"
          value={kpis?.payableToCourier ?? 0}
          hint="Negative courier position (we owe them)"
          accent="kpi-accent-danger"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 animate-rise" style={riseStyle(1)}>
        <Card className="kpi-card kpi-accent-warning">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Not yet collected</CardTitle>
          </CardHeader>
          <CardContent className="kpi-value">
            <CountUp value={buckets?.notYetCollected ?? 0} format={bdt} />
          </CardContent>
        </Card>
        <Card className="kpi-card kpi-accent-info">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Collected, not remitted</CardTitle>
          </CardHeader>
          <CardContent className="kpi-value">
            <CountUp value={buckets?.collectedNotRemitted ?? 0} format={bdt} />
          </CardContent>
        </Card>
      </div>

      <Card className="chart-card rounded-2xl animate-rise" style={riseStyle(2)}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2.5">
            <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
              <Wallet className="h-4 w-4" />
            </span>
            <CardTitle className="text-sm">Per-order position</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="dash-table">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Expected COD</TableHead>
                <TableHead className="text-right">Collected</TableHead>
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Payable</TableHead>
                <TableHead className="text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No COD orders with a settlement position.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((o) => (
                  <TableRow key={o.orderId}>
                    <TableCell className="font-medium">{o.displayId}</TableCell>
                    <TableCell className="text-right tabular-nums">{bdt(o.expectedCod)}</TableCell>
                    <TableCell className="text-right tabular-nums">{bdt(o.collected)}</TableCell>
                    <TableCell className="text-right tabular-nums">{bdt(o.charges)}</TableCell>
                    <TableCell className="text-right tabular-nums">{bdt(o.net)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.outstandingCod > 0 ? bdt(o.outstandingCod) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.payableToCourier > 0 ? bdt(o.payableToCourier) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{o.settlementRows}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
