import { useState } from 'react'
import { Loader2, RotateCcw, LogIn, LogOut, Coffee, CircleAlert } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import {
  ATTENDANCE_METHOD_LABELS,
  ATTENDANCE_STATUS_BADGE,
  ATTENDANCE_STATUS_LABELS,
  formatDuration,
  formatTime,
  toDateKey,
  type AttendanceMethod,
  type AttendanceStatus,
  type DayStateValue,
} from '../api'
import {
  useTodayStateQuery,
  useCheckInMutation,
  useBreakStartMutation,
  useBreakEndMutation,
  useCheckOutMutation,
  useAttendanceHistoryQuery,
} from '../hooks'

const METHOD_TONE: Record<AttendanceMethod, string> = {
  APP: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  MACHINE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  NONE: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

const MAIN_TONE: Record<DayStateValue, string> = {
  none: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  before_work: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  working: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  on_break: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  checked_out: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
}

export function TodayState({
  employeeId,
  onEmployeeIdChange,
  hideEmployeeSelect = false,
}: {
  employeeId: string
  onEmployeeIdChange: (id: string) => void
  hideEmployeeSelect?: boolean
}) {
  const [date, setDate] = useState<Date>(() => new Date())
  const dateKey = toDateKey(date)

  const { data: employees } = useQuery({
    queryKey: ['employees', 'hr-attendance-today-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })

  const selected = (employees || []).find((e: EmployeeResponse) => e.id === employeeId)

  const today = useTodayStateQuery(employeeId, dateKey)
  const { data: history } = useAttendanceHistoryQuery(employeeId, dateKey, dateKey)
  const dayRow = Array.isArray(history) ? history[0] : undefined

  const checkInMut = useCheckInMutation()
  const breakStartMut = useBreakStartMutation()
  const breakEndMut = useBreakEndMutation()
  const checkOutMut = useCheckOutMutation()

  const state: DayStateValue = today.data?.state ?? 'none'

  function renderBody() {
    if (!employeeId) {
      return (
        <div className='flex items-center gap-2 py-10 text-sm text-muted-foreground'>
          <CircleAlert className='h-4 w-4' /> Select an employee to view today's attendance state.
        </div>
      )
    }
    if (today.isLoading) {
      return (
        <div className='flex justify-center py-10'>
          <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
        </div>
      )
    }
    if (today.isError) {
      return (
        <div className='flex flex-col items-center gap-3 py-10 text-center'>
          <p className='text-sm text-muted-foreground'>Could not load today's attendance state.</p>
          <Button variant='outline' size='sm' onClick={() => today.refetch()}>
            <RotateCcw className='h-4 w-4 mr-1' /> Retry
          </Button>
        </div>
      )
    }

    const worked = today.data?.workedMinutes ?? 0
    const broken = today.data?.breakMinutes ?? 0

    switch (state) {
      case 'working': {
        const pending = breakStartMut.isPending || checkOutMut.isPending
        return (
          <div className='flex flex-col gap-4 py-4'>
            <div>
              <span className={`inline-block rounded-md px-3 py-1.5 text-sm font-semibold ${MAIN_TONE.working}`}>
                Working
              </span>
              <p className='mt-3 text-sm text-muted-foreground'>
                Since <span className='font-medium text-foreground'>{formatTime(today.data?.checkInAt)}</span> ·
                Worked {formatDuration(worked)} · Break {formatDuration(broken)}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button size='sm' disabled={breakStartMut.isPending} onClick={() => breakStartMut.mutate(employeeId)}>
                {breakStartMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                <Coffee className='h-4 w-4 mr-1.5' /> Start Break
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={pending || checkOutMut.isPending}
                onClick={() => checkOutMut.mutate({ employeeId })}
              >
                {checkOutMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                <LogOut className='h-4 w-4 mr-1.5' /> Check Out
              </Button>
            </div>
          </div>
        )
      }
      case 'on_break': {
        return (
          <div className='flex flex-col gap-4 py-4'>
            <div>
              <span className={`inline-block rounded-md px-3 py-1.5 text-sm font-semibold ${MAIN_TONE.on_break}`}>
                On Break
              </span>
              <p className='mt-3 text-sm text-muted-foreground'>
                Worked {formatDuration(worked)} · Break so far {formatDuration(broken)}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button size='sm' disabled={breakEndMut.isPending} onClick={() => breakEndMut.mutate(employeeId)}>
                {breakEndMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                <Coffee className='h-4 w-4 mr-1.5' /> End Break
              </Button>
            </div>
          </div>
        )
      }
      case 'checked_out': {
        const status: AttendanceStatus | undefined = dayRow?.status
        return (
          <div className='flex flex-col gap-4 py-4'>
            <div className='flex items-center gap-3'>
              <span className={`inline-block rounded-md px-3 py-1.5 text-sm font-semibold ${MAIN_TONE.checked_out}`}>
                Checked Out
              </span>
              {status && (
                <Badge className={`border-transparent ${ATTENDANCE_STATUS_BADGE[status]}`}>
                  {ATTENDANCE_STATUS_LABELS[status]}
                </Badge>
              )}
            </div>
            <p className='text-sm text-muted-foreground'>
              In {formatTime(today.data?.checkInAt)} · Out {formatTime(today.data?.checkOutAt)} · Worked{' '}
              {formatDuration(worked)} · Break {formatDuration(broken)}
            </p>
          </div>
        )
      }
      case 'before_work':
      case 'none':
      default: {
        return (
          <div className='flex flex-col gap-4 py-4'>
            <div>
              <span className={`inline-block rounded-md px-3 py-1.5 text-sm font-semibold ${MAIN_TONE.before_work}`}>
                Not Checked In
              </span>
              <p className='mt-3 text-sm text-muted-foreground'>
                No attendance session is open for {formatDateLabel(dateKey)}.
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button size='sm' disabled={checkInMut.isPending} onClick={() => checkInMut.mutate({ employeeId })}>
                {checkInMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                <LogIn className='h-4 w-4 mr-1.5' /> Check In
              </Button>
            </div>
          </div>
        )
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's State</CardTitle>
        <CardDescription>Check in/out and breaks for one employee on a date.</CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {!hideEmployeeSelect && (
            <div className='grid gap-2'>
              <Label>Employee</Label>
              <Select value={employeeId || 'none'} onValueChange={onEmployeeIdChange}>
                <SelectTrigger>
                  <SelectValue placeholder='Select employee' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>Select employee</SelectItem>
                  {(employees || []).map((e: EmployeeResponse) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.employeeId} · {e.betterAuthUser?.name || '—'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className='grid gap-2'>
            <Label>Date</Label>
            <DatePicker selected={date} onSelect={(d) => d && setDate(d)} placeholder='Pick date' />
          </div>
          {selected?.attendanceMethod && (
            <div className='grid gap-2'>
              <Label>Mode</Label>
              <div>
                <span
                  className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
                    METHOD_TONE[selected.attendanceMethod]
                  }`}
                >
                  {ATTENDANCE_METHOD_LABELS[selected.attendanceMethod]}
                </span>
              </div>
            </div>
          )}
        </div>
        {renderBody()}
      </CardContent>
    </Card>
  )
}

function formatDateLabel(dateKey: string) {
  const d = new Date(`${dateKey}T00:00:00`)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}