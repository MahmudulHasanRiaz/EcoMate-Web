import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBDT, type SalesSettlementRow, type SettlementAmount } from '../types'
import { SettlementGapBanner } from './FulfillmentEconomicsPanel'
import { MetricUnavailable } from './badges'
import { EmptyState } from './analytics-ui'

function Money({ amount }: { amount: SettlementAmount }) {
  if (amount.value === null || amount.state !== 'actual') {
    return <MetricUnavailable reason={amount.reason} compact />
  }
  return <span className="tabular-nums">{formatBDT(amount.value)}</span>
}

const INFERENCE_HINT = 'Shipping-refund inference — labelled, not measured (online orders only)'

function InferenceBadge({ inference }: { inference: 'covered' | 'below' | 'none' }) {
  if (inference === 'none') return <span className="text-[11px] text-muted-foreground">measured</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`inference: ${inference}. ${INFERENCE_HINT}`}
          className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Badge variant="warning">inference: {inference}</Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">{INFERENCE_HINT}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Full per-order settlement table (P5, §2.10 placement: Sales & Orders).
 * Paginated; every row carries its inference / unavailability disclosure.
 * COD rows render Unavailable with the canonical reason — never inferred.
 * "Not part of recognised revenue"; courierCost links to the ladder with
 * "same underlying cost, shown once in the ladder".
 */
export function SettlementTable({
  rows,
  total,
  page,
  pageSize,
  totalPages,
  gapBanner,
  panelNote,
  onPageChange,
}: {
  rows: SalesSettlementRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  gapBanner: { codOrders: number; courierCost: number; message: string }
  panelNote: string
  onPageChange: (page: number) => void
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Fulfillment Economics — Per-Order Settlement</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          {panelNote || 'Not part of recognised revenue.'} Courier cost is the{' '}
          <a href="/mon/analytics" className="underline underline-offset-2">
            same underlying cost, shown once in the ladder
          </a>
          .
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <SettlementGapBanner gapBanner={gapBanner} />
        {rows.length === 0 ? (
          <EmptyState message="No data" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Retained</TableHead>
                  <TableHead className="text-right">Delivery Charge Retained</TableHead>
                  <TableHead className="text-right">Courier Cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead>Disclosure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.orderId} data-testid={`settlement-row-${r.orderId}`}>
                    <TableCell className="text-sm">
                      <a href={`/op/orders/${r.orderId}`} className="font-medium underline underline-offset-2">
                        {r.displayId}
                      </a>
                      <span className="block text-[11px] text-muted-foreground">
                        {r.collection === 'online' ? 'online-collected' : r.collection === 'cod' ? 'cod-unavailable' : 'collection unavailable'}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{r.status}</TableCell>
                    <TableCell className="text-sm text-right">
                      <Money amount={r.amountCollected} />
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      <Money amount={r.amountRetained} />
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      <Money amount={r.deliveryChargeRetained} />
                      <span className="block mt-0.5">
                        <InferenceBadge inference={r.deliveryChargeRetained.inference} />
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      <Money amount={r.courierCost} />
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      <Money amount={r.fulfillmentMargin} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[220px]">
                      {r.disclosure ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing {from}–{to} of {total} order(s)
          </span>
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="tap-h" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Prev
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="sm" className="tap-h" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next
            </Button>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
