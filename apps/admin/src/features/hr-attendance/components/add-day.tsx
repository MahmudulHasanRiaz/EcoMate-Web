import { useEffect, useState } from 'react'
import { ChevronsUpDown, Loader2, Plus, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import {
  ATTENDANCE_STATUS_LABELS,
  dhakaTodayDate,
  toDateKey,
} from '../api'
import { useCreateDayMutation } from '../hooks'

type AddDayStatus = 'ABSENT' | 'ON_LEAVE' | 'WEEKLY_OFF'
const ADD_DAY_STATUSES: AddDayStatus[] = ['ABSENT', 'ON_LEAVE', 'WEEKLY_OFF']

function EmployeePicker({
  value,
  onSelect,
}: {
  value: string
  onSelect: (employee: EmployeeResponse) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])

  // Server-side search: page 1, 50 rows, search filter passed through.
  const { data } = useQuery({
    queryKey: ['employees', 'add-day-search', debounced],
    queryFn: () =>
      employeesApi
        .list({ page: 1, perPage: 50, search: debounced.trim() || undefined })
        .then((r) => r.data.data),
    enabled: open,
  })
  const options: EmployeeResponse[] = Array.isArray(data) ? data : []
  const selected = options.find((e) => e.id === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          role='combobox'
          aria-label='Employee'
          aria-expanded={open}
          className='w-full justify-between font-normal'
        >
          {value && selected ? (
            <span className='truncate'>
              {selected.employeeId} · {selected.betterAuthUser?.name || '—'}
            </span>
          ) : (
            <span className='text-muted-foreground'>Select employee</span>
          )}
          <ChevronsUpDown className='h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[--radix-popover-trigger-width] p-0' align='start'>
        <div className='flex items-center gap-2 border-b px-3 py-2'>
          <Search className='h-4 w-4 shrink-0 text-muted-foreground' />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search employees…'
            className='h-8 border-0 focus-visible:ring-0'
            aria-label='Search employees'
          />
        </div>
        <div className='max-h-[250px] overflow-y-auto p-1'>
          {options.length === 0 ? (
            <p className='px-3 py-4 text-center text-xs text-muted-foreground'>
              No employees found
            </p>
          ) : (
            options.map((e) => (
              <button
                key={e.id}
                type='button'
                onClick={() => {
                  onSelect(e)
                  setOpen(false)
                  setQuery('')
                }}
                className='flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground'
              >
                <span className='truncate'>
                  {e.employeeId} · {e.betterAuthUser?.name || '—'}
                </span>
                {e.department?.name && (
                  <span className='shrink-0 text-xs text-muted-foreground'>
                    {e.department.name}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function AddDayDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [employee, setEmployee] = useState<EmployeeResponse | null>(null)
  const [date, setDate] = useState<Date>(() => dhakaTodayDate())
  const [status, setStatus] = useState<AddDayStatus>('ABSENT')
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [dayMissing, setDayMissing] = useState(false)
  const createMut = useCreateDayMutation()

  useEffect(() => {
    if (!open) return
    setEmployee(null)
    setDate(dhakaTodayDate())
    setStatus('ABSENT')
    setReason('')
    setReasonTouched(false)
    setDayMissing(false)
  }, [open])

  const dateKey = toDateKey(date)

  function handleSubmit() {
    setDayMissing(false)
    if (!employee) {
      setDayMissing(true)
      return
    }
    if (!reason.trim()) {
      setReasonTouched(true)
      return
    }
    createMut.mutate(
      {
        employeeId: employee.id,
        date: dateKey,
        status,
        reason: reason.trim(),
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>Add Manual Day</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid gap-2'>
            <Label>Employee *</Label>
            <EmployeePicker value={employee?.id ?? ''} onSelect={setEmployee} />
            {dayMissing && (
              <p className='text-xs font-medium text-destructive'>
                Select an employee.
              </p>
            )}
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Date</Label>
              <DatePicker selected={date} onSelect={(d) => d && setDate(d)} placeholder='Pick date' />
            </div>
            <div className='grid gap-2'>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as AddDayStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADD_DAY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='grid gap-2'>
            <Label className={reasonTouched && !reason.trim() ? 'text-destructive' : undefined}>Reason *</Label>
            <Textarea
              aria-label='Reason'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='Why is this attendance day being recorded?'
              aria-invalid={reasonTouched && !reason.trim()}
            />
            {reasonTouched && !reason.trim() && (
              <p className='text-xs font-medium text-destructive'>Reason is required.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createMut.isPending}>
            {createMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            Save Day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AddDayAction({ canAdd }: { canAdd: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className='flex flex-col items-end gap-1'>
      <Button
        size='sm'
        disabled={!canAdd}
        title={
          canAdd
            ? 'Add a manual attendance day'
            : 'Requires Manage Attendance Adjustments permission'
        }
        onClick={() => setOpen(true)}
      >
        <Plus className='h-4 w-4 mr-1.5' /> Add Day
      </Button>
      {!canAdd && (
        <p className='text-xs text-muted-foreground'>
          Requires Manage Attendance Adjustments permission.
        </p>
      )}
      <AddDayDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
