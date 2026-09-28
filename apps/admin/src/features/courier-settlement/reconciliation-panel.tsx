import { Link } from '@tanstack/react-router'
import { ArrowRightLeft } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useReconciliation } from './hooks'
import { InvoiceStateBadge } from './state-badge'

/**
 * Reconciliation workspace tab: one row per invoice with its exception health
 * at a glance — red (blocking), yellow (needs acknowledgement), acknowledged
 * and the derived "needs attention" count. Drills into the invoice detail
 * (Reconciliation tab) where rows can actually be matched / acknowledged.
 */
export function ReconciliationPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useReconciliation({
    page: 1,
    limit: 50,
  })

  const rows = data?.data ?? []
  const meta = data?.meta
  const totals = rows.reduce(
    (acc, r) => ({
      red: acc.red + r.red,
      yellow: acc.yellow + r.yellow,
      acknowledged: acc.acknowledged + r.acknowledged,
      needsAttention: acc.needsAttention + r.needsAttention,
    }),
    { red: 0, yellow: 0, acknowledged: 0, needsAttention: 0 },
  )

  return (
    <Card className="chart-card rounded-2xl animate-rise">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
              <ArrowRightLeft className="h-4 w-4" />
            </span>
            <CardTitle className="text-sm">Invoice reconciliation status</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="tap-h"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-wrap gap-4 border-b px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            RED <Badge variant="danger" className="ml-1">{totals.red}</Badge>
          </span>
          <span className="text-muted-foreground">
            YELLOW <Badge variant="warning" className="ml-1">{totals.yellow}</Badge>
          </span>
          <span className="text-muted-foreground">
            Acknowledged <Badge variant="outline" className="ml-1">{totals.acknowledged}</Badge>
          </span>
          <span className="text-muted-foreground">
            Needs attention{' '}
            <Badge variant="info" className="ml-1">
              {totals.needsAttention}
            </Badge>
          </span>
        </div>

        <Table className="dash-table">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Courier</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Matched</TableHead>
              <TableHead className="text-right">RED</TableHead>
              <TableHead className="text-right">YELLOW</TableHead>
              <TableHead className="text-right">Acknowledged</TableHead>
              <TableHead className="text-right">Needs attention</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  Loading reconciliation…
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-danger">
                  Failed to load reconciliation. Nothing is shown rather than an incomplete picture.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No invoices to reconcile yet. Import a courier invoice first.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.invoiceId}>
                  <TableCell>
                    <Link
                      to="/op/courier-settlement/$id"
                      params={{ id: r.invoiceId }}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.displayId}
                    </Link>
                  </TableCell>
                  <TableCell className="capitalize">{r.courier}</TableCell>
                  <TableCell>
                    <InvoiceStateBadge state={r.state} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.matched}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.red ? (
                      <Badge variant="danger">{r.red}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.yellow ? (
                      <Badge variant="warning">{r.yellow}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.acknowledged}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.needsAttention ? (
                      <Badge variant="info">
                        {r.needsAttention}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="border-t p-3 text-sm text-muted-foreground">
          {meta ? `${meta.total} invoice(s) · page ${meta.page} of ${Math.max(meta.pages, 1)}` : ''}
        </div>
      </CardContent>
    </Card>
  )
}
