import { BarChart3 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBDT, type BreakdownRow } from '../types'

/** Top-N breakdown rows (backend folds the remainder into "Other"). */
export function BreakdownTable({ title, rows, hint }: { title: string; rows: BreakdownRow[]; hint?: string }) {
  return (
    <Card className="chart-card rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">No data</div>
        ) : (
          <Table className="dash-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Net Sales</TableHead>
                <TableHead className="text-right">Orders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="text-sm">{r.label}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{formatBDT(r.netSales)}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{r.orders}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
