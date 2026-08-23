import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { useAttendanceHistoryQuery } from '../hooks'
import { AttendanceDialog } from './attendance-dialog'
import {
  ATTENDANCE_STATUS_BADGE,
  ATTENDANCE_STATUS_LABELS,
  formatDate,
  formatTime,
  type AttendanceRecord,
} from '../api'

export function AttendanceTab({ employeeId }: { employeeId: string }) {
  const [markOpen, setMarkOpen] = useState(false)
  const { data, isLoading, isError, refetch } = useAttendanceHistoryQuery(employeeId)

  const rows: AttendanceRecord[] = Array.isArray(data) ? data : []

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Attendance</CardTitle>
            <p className='text-sm text-muted-foreground'>
              Daily attendance history for this employee.
            </p>
          </div>
          <AttendanceDialog
            open={markOpen}
            onOpenChange={setMarkOpen}
            defaultEmployeeId={employeeId}
            defaultDate={new Date()}
            trigger={
              <Button size='sm'>
                <span className='mr-1'>+</span> Mark Today
              </Button>
            }
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load attendance history.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
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
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='text-sm text-muted-foreground'>{formatDate(row.date)}</TableCell>
                  <TableCell>
                    <Badge className={`border-transparent ${ATTENDANCE_STATUS_BADGE[row.status]}`}>
                      {ATTENDANCE_STATUS_LABELS[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{formatTime(row.checkInTime)}</TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{formatTime(row.checkOutTime)}</TableCell>
                  <TableCell className='max-w-[240px] truncate text-sm text-muted-foreground' title={row.note ?? undefined}>
                    {row.note || '—'}
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