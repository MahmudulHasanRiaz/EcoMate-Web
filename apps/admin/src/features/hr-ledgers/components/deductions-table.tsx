import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useDeductionsQuery, useApproveDeductionMutation } from '../hooks'
import type { DeductionRow, LedgerStatus } from '../api'
import { DeductionDialog } from './deduction-dialog'

function StatusBadge({ status }: { status: LedgerStatus }) {
  if (status === 'approved') {
    return (
      <Badge className='border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'>
        Approved
      </Badge>
    )
  }
  if (status === 'paid') {
    return (
      <Badge className='border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'>
        Paid
      </Badge>
    )
  }
  return (
    <Badge className='border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'>
      Draft
    </Badge>
  )
}

const TYPE_LABELS: Record<string, string> = {
  fine: 'Fine',
  other: 'Other',
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function DeductionsTable({ employeeId, page: initialPage }: { employeeId: string; page?: number }) {
  const [page, setPage] = useState(initialPage ?? 1)
  const { data, isLoading } = useDeductionsQuery({ employeeId, page })
  const approveMut = useApproveDeductionMutation(employeeId)

  const rows: DeductionRow[] = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Deductions</CardTitle>
            <CardDescription>Fines and other deductions from salary.</CardDescription>
          </div>
          <DeductionDialog employeeId={employeeId} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>No deductions recorded yet</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applicable</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='w-24'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='text-sm text-muted-foreground'>
                    {formatDate(row.applicableFrom)}
                    {row.applicableTo ? ` – ${formatDate(row.applicableTo)}` : ''}
                  </TableCell>
                  <TableCell className='font-medium'>{TYPE_LABELS[row.type] || row.type}</TableCell>
                  <TableCell className='max-w-[280px] truncate'>{row.reason}</TableCell>
                  <TableCell className='text-right font-medium tabular-nums text-destructive'>
                    {Number(row.amount).toLocaleString()} ৳
                  </TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell>
                    <Button
                      variant='ghost'
                      size='sm'
                      disabled={row.status !== 'draft' || approveMut.isPending}
                      onClick={() => approveMut.mutate(row.id)}
                    >
                      {approveMut.isPending && approveMut.variables === row.id ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' /> : null}
                      Approve
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between border-t px-2 py-2'>
            <p className='text-sm'>{meta.total} total</p>
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
