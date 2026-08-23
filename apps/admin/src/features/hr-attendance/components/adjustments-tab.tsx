import { useState, useEffect } from 'react'
import { Loader2, RotateCcw, Plus, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import { useQuery } from '@tanstack/react-query'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  formatDate,
  toDateKey,
  type AdjustmentField,
  type AttendanceStatus,
} from '../api'
import { useAdjustmentsQuery, useCreateAdjustmentMutation, useAttendanceHistoryQuery } from '../hooks'

const ADJUSTABLE_FIELDS: { value: AdjustmentField; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'workedMinutes', label: 'Worked minutes' },
  { value: 'breakMinutes', label: 'Break minutes' },
]

function AdjustmentsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState<Date>(() => new Date())
  const [field, setField] = useState<AdjustmentField>('status')
  const [statusValue, setStatusValue] = useState<AttendanceStatus>('PRESENT')
  const [minutesValue, setMinutesValue] = useState('')
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [dayMissing, setDayMissing] = useState(false)

  const dateKey = date ? toDateKey(date) : undefined
  const { data: employees } = useQuery({
    queryKey: ['employees', 'attendance-adjustment-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })
  const { data: history, isLoading: dayLoading } = useAttendanceHistoryQuery(
    employeeId,
    dateKey,
    dateKey,
  )
  const createMut = useCreateAdjustmentMutation()

  useEffect(() => {
    if (!open) return
    setEmployeeId('')
    setDate(new Date())
    setField('status')
    setStatusValue('PRESENT')
    setMinutesValue('')
    setReason('')
    setReasonTouched(false)
    setDayMissing(false)
  }, [open])

  const day = Array.isArray(history) && history.length > 0 ? history[0] : undefined
  const dayId = day?.id

  const correctedValue =
    field === 'status' ? statusValue : field === 'workedMinutes' || field === 'breakMinutes' ? minutesValue : ''

  function handleSubmit() {
    setDayMissing(false)
    if (!employeeId) {
      setDayMissing(true)
      return
    }
    if (!dateKey) {
      setDayMissing(true)
      return
    }
    if (!dayId) {
      setDayMissing(true)
      return
    }
    if (!reason.trim()) {
      setReasonTouched(true)
      return
    }
    if (correctedValue === '' && field !== 'status') {
      return
    }
    createMut.mutate(
      {
        employeeId,
        dayId,
        field,
        correctedValue: String(correctedValue),
        reason: reason.trim(),
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const pending = createMut.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[540px]'>
        <DialogHeader>
          <DialogTitle>Add Adjustment</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger><SelectValue placeholder='Select employee' /></SelectTrigger>
                <SelectContent>
                  {(employees || []).map((e: EmployeeResponse) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.employeeId} · {e.betterAuthUser?.name || '—'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Date</Label>
              <DatePicker selected={date} onSelect={(d) => d && setDate(d)} placeholder='Pick date' />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Field</Label>
              <Select value={field} onValueChange={(v) => setField(v as AdjustmentField)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADJUSTABLE_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Corrected Value</Label>
              {field === 'status' ? (
                <Select value={statusValue} onValueChange={(v) => setStatusValue(v as AttendanceStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ATTENDANCE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type='number'
                  min={0}
                  step={1}
                  value={minutesValue}
                  onChange={(e) => setMinutesValue(e.target.value)}
                  placeholder='Minutes'
                />
              )}
            </div>
          </div>

          <div className='grid gap-2'>
            <Label className={reasonTouched && !reason.trim() ? 'text-destructive' : undefined}>Reason *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='Why is this day being adjusted?'
              aria-invalid={reasonTouched && !reason.trim()}
            />
            {reasonTouched && !reason.trim() && (
              <p className='text-xs font-medium text-destructive'>Reason is required.</p>
            )}
          </div>

          {dayMissing && (
            <div className='flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'>
              <AlertCircle className='h-4 w-4 mt-0.5 shrink-0' />
              <span>
                Select an employee and a date that has an attendance day. No day exists for the current
                selection, so the server will reject the adjustment.
              </span>
            </div>
          )}

          {dayLoading && (
            <p className='text-xs text-muted-foreground'>Checking attendance day…</p>
          )}

          {!dayLoading && employeeId && dateKey && day && (
            <p className='text-xs text-muted-foreground'>
              Adjusting the day of <span className='font-medium text-foreground'>{formatDate(day.date)}</span> ·
              current {field}:{' '}
              {field === 'status'
                ? ATTENDANCE_STATUS_LABELS[day.status]
                : field === 'workedMinutes'
                  ? (day.workedMinutes ?? '—')
                  : (day.breakMinutes ?? '—')}
            </p>
          )}
          {!dayLoading && employeeId && dateKey && !day && (
            <p className='text-xs text-muted-foreground'>No attendance day for this date.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            Save Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdjustmentsTab() {
  const [employeeId, setEmployeeId] = useState('')
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useAdjustmentsQuery(employeeId, page)

  const { data: employees } = useQuery({
    queryKey: ['employees', 'attendance-adjustments-filter'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })

  const rows = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Adjustments</CardTitle>
            <CardDescription>
              Audit-trailed corrections to attendance days (status / worked / break minutes).
            </CardDescription>
          </div>
          <Button size='sm' onClick={() => setDialogOpen(true)}>
            <Plus className='h-4 w-4 mr-1.5' /> Add Adjustment
          </Button>
        </div>
      </CardHeader>
      <CardContent className='grid gap-4'>
        <div className='grid gap-3 sm:max-w-xs'>
          <Label>Employee (optional)</Label>
          <Select value={employeeId || 'all'} onValueChange={(v) => { setEmployeeId(v === 'all' ? '' : v); setPage(1) }}>
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

        {isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load adjustments.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>
            No adjustments found.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Original</TableHead>
                <TableHead>Corrected</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Adjusted At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='font-medium'>
                    {row.employee?.employeeId} · {row.employee?.betterAuthUser?.name || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant='outline'>{row.field}</Badge>
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{row.originalValue ?? '—'}</TableCell>
                  <TableCell className='text-sm font-medium'>{row.correctedValue}</TableCell>
                  <TableCell className='max-w-[240px] truncate text-sm text-muted-foreground' title={row.reason}>
                    {row.reason}
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>{formatDate(row.adjustedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between text-sm'>
            <span className='text-muted-foreground'>
              Page {meta.page} of {meta.totalPages} · {meta.total} adjustment{meta.total === 1 ? '' : 's'}
            </span>
            <div className='flex items-center gap-2'>
              <Button variant='outline' size='sm' disabled={meta.page <= 1} onClick={() => setPage(meta.page - 1)}>
                Prev
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage(meta.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <AdjustmentsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  )
}