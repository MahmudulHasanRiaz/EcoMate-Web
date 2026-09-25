import { ArrowRightLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBDT, type SalesPipelineStage } from '../types'

/**
 * Pre-delivery pipeline (P5, §2.1): not-yet-recognised orders by stage with
 * counts + intake values. Labelled pipeline on every row — never revenue.
 */
export function PipelinePanel({
  stages,
  totalOrders,
  totalValue,
}: {
  stages: SalesPipelineStage[]
  totalOrders: number
  totalValue: number
}) {
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
            <ArrowRightLeft className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-sm font-medium">Pre-Delivery Pipeline</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Not-yet-recognised orders by stage — pipeline, never revenue. {totalOrders} order(s) · {formatBDT(totalValue)} intake value.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {stages.every((s) => s.orders === 0) ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">No data</div>
        ) : (
          <Table className="dash-table">
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Pipeline Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="text-sm">
                    {s.label}
                    <span className="block text-[11px] text-muted-foreground">{s.note}</span>
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{s.orders}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{formatBDT(s.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
