import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import {
  useLeaveRequestsQuery,
  useApproveRequestMutation,
  useRejectRequestMutation,
  useCancelRequestMutation,
} from '../hooks'
import type { LeaveRequest, LeaveStatus } from '../api'

const STATUS_BADGE: Record<LeaveStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  cancelled: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
}

export function LeaveRequestTable({
  employeeId,
  status,
  page,
  onReject,
  onPageChange,
}: {
  employeeId?: string
  status?: LeaveStatus
  page: number
  onReject: (req: LeaveRequest) => void
  onPageChange: (page: number) => void
}) {
  const { data, isLoading } = useLeaveRequestsQuery({ employeeId, status, page })
  const approveMut = useApproveRequestMutation()
  const cancelMut = useCancelRequestMutation()

  const rows: LeaveRequest[] = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta

  return (
    <>
      {isLoading ? (
        <div className='flex justify-center py-8'>
          <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
        </div>
      ) : rows.length === 0 ? (
        <div className='py-8 text-center text-sm text-muted-foreground'>No leave requests.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Range</TableHead>
              <TableHead className='text-right'>Days</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='w-40'>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((req) => (
              <TableRow key={req.id}>
                <TableCell className='font-medium'>
                  {req.employee?.employeeId} · {req.employee?.betterAuthUser?.name || '—'}
                </TableCell>
                <TableCell>
                  <div className='font-medium'>{req.type?.name}</div>
                  <div className='text-xs text-muted-foreground'>{req.type?.code}</div>
                </TableCell>
                <TableCell className='text-sm text-muted-foreground'>
                  {new Date(req.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} –{' '}
                  {new Date(req.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </TableCell>
                <TableCell className='text-right tabular-nums'>{req.days}</TableCell>
                <TableCell className='max-w-[200px] truncate' title={req.reason}>{req.reason}</TableCell>
                <TableCell>
                  <Badge className={`border-transparent ${STATUS_BADGE[req.status]}`}>
                    {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className='flex flex-wrap items-center gap-1'>
                    {req.status === 'pending' && (
                      <>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='text-emerald-600'
                          disabled={approveMut.isPending}
                          onClick={() => approveMut.mutate({ id: req.id })}
                        >
                          Approve
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='text-rose-600'
                          onClick={() => onReject(req)}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {(req.status === 'pending' || req.status === 'approved') && (
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={cancelMut.isPending}
                        onClick={() => cancelMut.mutate(req.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {meta && meta.totalPages > 1 && (
        <div className='mt-3 flex items-center justify-between text-sm'>
          <span className='text-muted-foreground'>
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={meta.page <= 1}
              onClick={() => onPageChange(meta.page - 1)}
            >
              Prev
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={meta.page >= meta.totalPages}
              onClick={() => onPageChange(meta.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
