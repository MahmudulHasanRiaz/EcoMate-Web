import { useState } from 'react'
import { Loader2, RotateCcw, LogIn, LogOut, Coffee } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import {
  ATTENDANCE_STATUS_BADGE,
  ATTENDANCE_STATUS_LABELS,
  dhakaTodayDate,
  formatDate,
  formatDuration,
  formatTime,
  sessionTimes,
  toDateKey,
  type AttendanceDayRow,
} from '../api'
import {
  useAttendanceHistoryQuery,
  useTodayStateQuery,
  useCheckInMutation,
  useBreakStartMutation,
  useBreakEndMutation,
  useCheckOutMutation,
} from '../hooks'
import { MissingCheckoutBadge, CloseSessionAction } from './close-session'

export function AttendanceTab({ employeeId }: { employeeId: string }) {
  const [date] = useState<Date>(() => dhakaTodayDate())
  const dateKey = toDateKey(date)

  const today = useTodayStateQuery(employeeId, dateKey)
  const history = useAttendanceHistoryQuery(employeeId)

  const checkInMut = useCheckInMutation()
  const breakStartMut = useBreakStartMutation()
  const breakEndMut = useBreakEndMutation()
  const checkOutMut = useCheckOutMutation()

  const rows: AttendanceDayRow[] = Array.isArray(history.data) ? history.data : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
        <p className='text-sm text-muted-foreground'>
          Today's live state and the full history for this employee.
        </p>
      </CardHeader>
      <CardContent className='grid gap-6'>
        <div className='rounded-lg border p-4'>
          <div className='flex items-center justify-between gap-3'>
            <div>
              <p className='text-sm font-semibold'>Today</p>
              {today.isLoading ? (
                <div className='flex items-center gap-2 py-2 text-sm text-muted-foreground'>
                  <Loader2 className='animate-spin h-4 w-4' /> Loading…
                </div>
              ) : today.isError ? (
                <div className='py-2 text-sm text-muted-foreground'>
                  Could not load today's state.{' '}
                  <Button variant='link' size='sm' className='p-0 h-auto' onClick={() => today.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : (
                <p className='py-2 text-sm text-muted-foreground'>
                  {todayStateCopy(today.data?.state, today.data?.checkInAt)}
                  {today.data?.state === 'checked_out' || today.data?.state === 'working' || today.data?.state === 'on_break'
                    ? ` · Worked ${formatDuration(today.data?.workedMinutes)} · Break ${formatDuration(today.data?.breakMinutes)}`
                    : ''}
                </p>
              )}
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {(today.data?.state === 'none' || today.data?.state === 'before_work') && (
                <Button
                  size='sm'
                  disabled={checkInMut.isPending}
                  onClick={() => checkInMut.mutate({ employeeId })}
                >
                  {checkInMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                  <LogIn className='h-4 w-4 mr-1.5' /> Check In
                </Button>
              )}
              {today.data?.state === 'working' && (
                <>
                  <Button size='sm' disabled={breakStartMut.isPending} onClick={() => breakStartMut.mutate(employeeId)}>
                    {breakStartMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                    <Coffee className='h-4 w-4 mr-1.5' /> Start Break
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={checkOutMut.isPending}
                    onClick={() => checkOutMut.mutate({ employeeId })}
                  >
                    {checkOutMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                    <LogOut className='h-4 w-4 mr-1.5' /> Check Out
                  </Button>
                </>
              )}
              {today.data?.state === 'on_break' && (
                <Button size='sm' disabled={breakEndMut.isPending} onClick={() => breakEndMut.mutate(employeeId)}>
                  {breakEndMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                  <Coffee className='h-4 w-4 mr-1.5' /> End Break
                </Button>
              )}
            </div>
          </div>
        </div>

        {history.isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : history.isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load attendance history.</p>
            <Button variant='outline' size='sm' onClick={() => history.refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>
            No attendance records for this employee.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead className='text-right'>Worked</TableHead>
                <TableHead className='text-right'>Break</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const times = sessionTimes(row)
                const missing = !!row.missingCheckout
                return (
                  <TableRow key={row.id}>
                    <TableCell className='text-sm text-muted-foreground'>{formatDate(row.date)}</TableCell>
                    <TableCell>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <Badge className={`border-transparent ${ATTENDANCE_STATUS_BADGE[row.status]}`}>
                          {ATTENDANCE_STATUS_LABELS[row.status]}
                        </Badge>
                        {missing && <MissingCheckoutBadge />}
                      </div>
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{formatTime(times.checkInAt)}</TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{formatTime(times.checkOutAt)}</TableCell>
                    <TableCell className='text-right text-sm text-muted-foreground tabular-nums'>
                      {formatDuration(row.workedMinutes)}
                    </TableCell>
                    <TableCell className='text-right text-sm text-muted-foreground tabular-nums'>
                      {formatDuration(row.breakMinutes)}
                    </TableCell>
                    <TableCell>{missing ? <CloseSessionAction dayId={row.id} /> : '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function todayStateCopy(state?: string, checkInAt?: string): string {
  switch (state) {
    case 'working':
      return `Working since ${formatTime(checkInAt)}`
    case 'on_break':
      return 'On Break'
    case 'checked_out':
      return 'Checked Out'
    case 'none':
    case 'before_work':
    default:
      return 'Not checked in yet'
  }
}