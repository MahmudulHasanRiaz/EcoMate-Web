import { useState, useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import { useQuery } from '@tanstack/react-query'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  formatDate,
  toDateKey,
  toTimeInput,
  type AttendanceRow,
  type AttendanceStatus,
} from '../api'
import { useCreateAttendanceMutation, useUpdateAttendanceMutation } from '../hooks'

export function AttendanceDialog({
  open,
  onOpenChange,
  record,
  defaultEmployeeId,
  defaultDate,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  record?: AttendanceRow | null
  defaultEmployeeId?: string
  defaultDate?: Date
  trigger?: ReactNode
}) {
  const isEdit = !!record
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState<Date | undefined>()
  const [status, setStatus] = useState<AttendanceStatus>('PRESENT')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [note, setNote] = useState('')

  const { data: employees } = useQuery({
    queryKey: ['employees', 'attendance-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })
  const createMut = useCreateAttendanceMutation()
  const updateMut = useUpdateAttendanceMutation()

  useEffect(() => {
    if (!open) return
    setEmployeeId(record?.employeeId ?? defaultEmployeeId ?? '')
    setDate(isEdit ? new Date(record.date) : defaultDate ?? new Date())
    setStatus(record?.status ?? 'PRESENT')
    setCheckIn(toTimeInput(record?.checkInTime))
    setCheckOut(toTimeInput(record?.checkOutTime))
    setNote(record?.note ?? '')
  }, [open, record, defaultEmployeeId, defaultDate])

  function combineDateTime(time: string): string | undefined {
    if (!time) return undefined
    const [h, m] = time.split(':').map(Number)
    const d = date ? new Date(date) : new Date()
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }

  function handleSubmit() {
    if (!employeeId) {
      toast.error('Select an employee')
      return
    }
    if (!date) {
      toast.error('Select a date')
      return
    }
    const checkInTime = combineDateTime(checkIn)
    const checkOutTime = combineDateTime(checkOut)
    if (checkInTime && checkOutTime && new Date(checkOutTime) < new Date(checkInTime)) {
      toast.error('Check-out time must be on or after check-in time')
      return
    }
    if (isEdit) {
      updateMut.mutate(
        {
          id: record.id,
          dto: {
            ...(status !== record.status ? { status } : {}),
            ...(checkInTime !== record.checkInTime ? { checkInTime: checkInTime ?? null } : {}),
            ...(checkOutTime !== record.checkOutTime ? { checkOutTime: checkOutTime ?? null } : {}),
            ...(note !== (record.note ?? '') ? { note: note.trim() || null } : {}),
          },
        },
        { onSuccess: () => onOpenChange(false) },
      )
      return
    }
    createMut.mutate(
      {
        employeeId,
        date: toDateKey(date),
        status,
        ...(checkInTime ? { checkInTime } : {}),
        ...(checkOutTime ? { checkOutTime } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const pending = createMut.isPending || updateMut.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Attendance Record' : 'Add Attendance Record'}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid gap-2'>
            <Label>Employee</Label>
            {isEdit ? (
              <div className='rounded-md border border-input bg-muted/40 px-3 py-2 text-sm'>
                {record.employee?.employeeId} · {record.employee?.betterAuthUser?.name || '—'}
              </div>
            ) : (
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
            )}
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Date</Label>
              {isEdit ? (
                <div className='rounded-md border border-input bg-muted/40 px-3 py-2 text-sm'>
                  {formatDate(record.date)}
                </div>
              ) : (
                <DatePicker selected={date} onSelect={setDate} placeholder='Pick date' />
              )}
            </div>
            <div className='grid gap-2'>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as AttendanceStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Check In (optional)</Label>
              <Input type='time' value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </div>
            <div className='grid gap-2'>
              <Label>Check Out (optional)</Label>
              <Input type='time' value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
          <div className='grid gap-2'>
            <Label>Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Note about this record'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            {isEdit ? 'Save Changes' : 'Create Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}