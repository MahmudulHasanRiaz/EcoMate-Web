import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBDT, type BreakdownRow } from '../types'

/** Top-N breakdown rows (backend folds the remainder into "Other"). */
export function BreakdownTable({ title, rows, hint }: { title: string; rows: BreakdownRow[]; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">No data</div>
        ) : (
          <Table>
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
