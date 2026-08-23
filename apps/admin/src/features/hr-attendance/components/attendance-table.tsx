import { Loader2, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import { useQuery } from '@tanstack/react-query'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import { useDepartmentsQuery } from '@/features/departments/hooks'
import { useAttendanceQuery } from '../hooks'
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_BADGE,
  ATTENDANCE_STATUS_LABELS,
  formatDate,
  formatDuration,
  formatTime,
  sessionTimes,
  toDateKey,
  type AttendanceDayRow,
  type AttendanceStatus,
} from '../api'

export function AttendanceTable({
  date,
  onDateChange,
  employeeId,
  onEmployeeChange,
  status,
  onStatusChange,
  departmentId,
  onDepartmentChange,
  page,
  onPageChange,
}: {
  date: Date
  onDateChange: (date: Date | undefined) => void
  employeeId: string
  onEmployeeChange: (id: string) => void
  status: AttendanceStatus | 'all'
  onStatusChange: (status: AttendanceStatus | 'all') => void
  departmentId: string
  onDepartmentChange: (id: string) => void
  page: number
  onPageChange: (page: number) => void
}) {
  const dateKey = toDateKey(date)

  const { data, isLoading, isError, refetch } = useAttendanceQuery({
    date: dateKey,
    employeeId: employeeId || undefined,
    status: status === 'all' ? undefined : status,
    departmentId: departmentId || undefined,
    page,
  })

  const { data: employees } = useQuery({
    queryKey: ['employees', 'attendance-filter-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })

  const { data: departments } = useDepartmentsQuery()

  const rows: AttendanceDayRow[] = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta

  return (
    <>
      <div className='mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <div className='grid gap-2'>
          <Label>Date</Label>
          <DatePicker selected={date} onSelect={onDateChange} placeholder='Pick date' />
        </div>
        <div className='grid gap-2'>
          <Label>Employee (optional)</Label>
          <Select value={employeeId || 'all'} onValueChange={(v) => onEmployeeChange(v === 'all' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder='All employees' /></SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All employees</SelectItem>
              {(employees || []).map((e: EmployeeResponse) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.employeeId} · {e.betterAuthUser?.name || '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-2'>
          <Label>Status (optional)</Label>
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger><SelectValue placeholder='All statuses' /></SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All statuses</SelectItem>
              {ATTENDANCE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-2'>
          <Label>Department (optional)</Label>
          <Select value={departmentId || 'all'} onValueChange={(v) => onDepartmentChange(v === 'all' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder='All departments' /></SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All departments</SelectItem>
              {(departments?.data || []).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className='flex justify-center py-8'>
          <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
        </div>
      ) : isError ? (
        <div className='flex flex-col items-center gap-3 py-10 text-center'>
          <p className='text-sm text-muted-foreground'>Could not load attendance records.</p>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            <RotateCcw className='h-4 w-4 mr-1' /> Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className='py-8 text-center text-sm text-muted-foreground'>
          No attendance records for this date/filter.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Check In</TableHead>
              <TableHead>Check Out</TableHead>
              <TableHead className='text-right'>Worked</TableHead>
              <TableHead className='text-right'>Break</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const times = sessionTimes(row)
              return (
                <TableRow key={row.id}>
                  <TableCell className='font-medium'>
                    {row.employee?.employeeId} · {row.employee?.betterAuthUser?.name || '—'}
                    {row.employee?.department?.name && (
                      <div className='text-xs text-muted-foreground'>{row.employee.department.name}</div>
                    )}
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{formatDate(row.date)}</TableCell>
                  <TableCell>
                    <Badge className={`border-transparent ${ATTENDANCE_STATUS_BADGE[row.status]}`}>
                      {ATTENDANCE_STATUS_LABELS[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{formatTime(times.checkInAt)}</TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{formatTime(times.checkOutAt)}</TableCell>
                  <TableCell className='text-right text-sm text-muted-foreground tabular-nums'>
                    {formatDuration(row.workedMinutes)}
                  </TableCell>
                  <TableCell className='text-right text-sm text-muted-foreground tabular-nums'>
                    {formatDuration(row.breakMinutes)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {meta && meta.totalPages > 1 && (
        <div className='mt-3 flex items-center justify-between text-sm'>
          <span className='text-muted-foreground'>
            Page {meta.page} of {meta.totalPages} · {meta.total} record{meta.total === 1 ? '' : 's'}
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