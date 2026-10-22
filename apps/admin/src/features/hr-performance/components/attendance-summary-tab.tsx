import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { formatDuration } from '@/features/hr-attendance/api'
import { formatDhakaDate } from '@/lib/dhaka-time'

interface AttendanceSummaryTabProps {
  from?: string
  to?: string
  departmentId?: string
  employeeId?: string
}

export function AttendanceSummaryTab({
  from,
  to,
  departmentId,
  employeeId,
}: AttendanceSummaryTabProps) {
  const [page, setPage] = useState(1)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hr-attendance', 'summary-tab', { from, to, departmentId, employeeId, page }],
    queryFn: () =>
      apiClient
        .get<{
          data: any[]
          meta: { page: number; perPage: number; total: number; totalPages: number }
        }>('/hr/attendance', {
          params: {
            from,
            to,
            departmentId,
            employeeId,
            page,
            perPage: 15,
          },
        })
        .then((res) => res.data),
  })

  const records = data?.data || []
  const meta = data?.meta

  return (
    <Card className='border-border/60'>
      <div className='p-4 border-b flex flex-col gap-1'>
        <h3 className='font-bold text-base'>Attendance Log &amp; Time Summary</h3>
        <p className='text-xs text-muted-foreground'>
          Daily attendance sessions, worked duration, breaks, overtime, and punctuality
        </p>
      </div>

      <div className='overflow-x-auto'>
        <Table>
          <TableHeader className='bg-muted/30'>
            <TableRow>
              <TableHead className='min-w-[180px]'>Employee</TableHead>
              <TableHead className='text-center'>Date</TableHead>
              <TableHead className='text-center'>Status</TableHead>
              <TableHead className='text-center'>Worked Time</TableHead>
              <TableHead className='text-center'>Break Time</TableHead>
              <TableHead className='text-center'>Overtime</TableHead>
              <TableHead className='text-center'>Late</TableHead>
              <TableHead className='text-center'>Early Leave</TableHead>
              <TableHead className='text-center'>Exceptions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className='h-8 w-36' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-20 mx-auto' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                  <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={9} className='text-center py-8 text-rose-500'>
                  Failed to load attendance records.
                  <Button variant='link' onClick={() => refetch()} className='ml-2 text-xs'>
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className='text-center py-10 text-muted-foreground'>
                  No attendance records found for this date range and filter criteria.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r: any) => {
                const emp = r.employee
                const name = emp?.betterAuthUser?.name || 'Unknown'
                const code = emp?.employeeId || '—'
                const dept = emp?.department?.name
                const dateStr = formatDhakaDate(r.date)

                return (
                  <TableRow key={r.id} className='hover:bg-muted/30'>
                    <TableCell>
                      <div className='flex items-center gap-3'>
                        <Avatar className='h-8 w-8 rounded-lg'>
                          {emp?.profilePictureUrl && (
                            <AvatarImage src={emp.profilePictureUrl} alt={name} />
                          )}
                          <AvatarFallback className='rounded-lg text-xs font-bold'>
                            {name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className='min-w-0'>
                          <p className='text-xs font-semibold truncate'>{name}</p>
                          <p className='text-[10px] text-muted-foreground truncate'>
                            {code} {dept ? `· ${dept}` : ''}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className='text-center font-mono text-xs'>
                      {dateStr}
                    </TableCell>

                    <TableCell className='text-center'>
                      <Badge variant='outline' className='text-[10px] font-bold uppercase'>
                        {r.status}
                      </Badge>
                    </TableCell>

                    <TableCell className='text-center font-mono text-xs tabular-nums'>
                      {formatDuration(r.workedMinutes ?? 0)}
                    </TableCell>

                    <TableCell className='text-center font-mono text-xs tabular-nums text-muted-foreground'>
                      {formatDuration(r.breakMinutes ?? 0)}
                    </TableCell>

                    <TableCell className='text-center font-mono text-xs tabular-nums text-amber-600 font-semibold'>
                      {r.overtimeMinutes ? formatDuration(r.overtimeMinutes) : '—'}
                    </TableCell>

                    <TableCell className='text-center font-mono text-xs tabular-nums text-rose-500'>
                      {r.lateMinutes ? `${r.lateMinutes}m` : '—'}
                    </TableCell>

                    <TableCell className='text-center font-mono text-xs tabular-nums text-orange-500'>
                      {r.earlyLeaveMinutes ? `${r.earlyLeaveMinutes}m` : '—'}
                    </TableCell>

                    <TableCell className='text-center'>
                      {r.missingCheckout ? (
                        <Badge variant='destructive' className='text-[9px] gap-1 px-1.5 py-0.5'>
                          <AlertTriangle className='h-2.5 w-2.5' /> Missing Checkout
                        </Badge>
                      ) : (
                        <span className='text-xs text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className='flex items-center justify-between p-4 border-t'>
          <span className='text-xs text-muted-foreground'>
            Showing {records.length} of {meta.total} records
          </span>
          <div className='flex items-center gap-1'>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className='h-4 w-4' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-8 w-8 p-0'
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className='h-4 w-4' />
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
