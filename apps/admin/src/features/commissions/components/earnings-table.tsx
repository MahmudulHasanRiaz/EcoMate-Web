import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useCommissionEarningsQuery } from '../hooks'
import type { CommissionEarningRow } from '../api'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusBadge() {
  return (
    <Badge className='border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'>
      Approved
    </Badge>
  )
}

export function CommissionEarningsTab({ employeeId, page: initialPage }: { employeeId: string; page?: number }) {
  const [page, setPage] = useState(initialPage ?? 1)
  const { data, isLoading } = useCommissionEarningsQuery({ employeeId, page })

  const rows: CommissionEarningRow[] = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Commission Earnings</CardTitle>
          <CardDescription>Approved commission payouts generated for this employee.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>No commission earnings yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='text-sm text-muted-foreground'>{formatDate(row.createdAt)}</TableCell>
                  <TableCell className='font-medium truncate'>{row.order?.displayId || row.orderId}</TableCell>
                  <TableCell className='text-right font-medium tabular-nums'>
                    {Number(row.amount).toLocaleString()} ৳
                  </TableCell>
                  <TableCell><StatusBadge /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between border-t px-2 py-2'>
            <p className='text-sm text-muted-foreground'>{meta.total} total</p>
            <div className='flex items-center gap-2'>
              <Button variant='outline' className='h-8 w-8 p-0' disabled={meta.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <span className='sr-only'>Previous</span>‹
              </Button>
              <span className='text-sm text-muted-foreground'>Page {meta.page} of {meta.totalPages}</span>
              <Button variant='outline' className='h-8 w-8 p-0' disabled={meta.page >= meta.totalPages} onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}>
                <span className='sr-only'>Next</span>›
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
