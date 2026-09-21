'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBDT, type UncostedData } from '../types'

/**
 * Uncosted-products fix-list (§4.2 coverage badges): every recognised line
 * without a costSnapshot, drilling to the contributing order. Reached from
 * the coverage badge on the product list and detail pages.
 */
export function UncostedFixList({ uncosted }: { uncosted: UncostedData }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Uncosted lines fix-list — {uncosted.totals.lines} line(s), {uncosted.totals.units} unit(s) without costSnapshot
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          COGS uses costSnapshot only — the current standardCost is never a fallback. Cost these lines to restore actual coverage.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {uncosted.rows.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">No uncosted lines</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Line Net</TableHead>
                <TableHead>Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uncosted.rows.map((r) => (
                <TableRow key={r.orderItemId}>
                  <TableCell className="text-sm">{r.productName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.variantLabel}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{formatBDT(r.lineNet)}</TableCell>
                  <TableCell className="text-sm">
                    <a href={`/op/orders/${r.orderId}`} className="hover:underline">
                      Order →
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
