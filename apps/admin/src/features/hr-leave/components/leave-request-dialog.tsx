import { useState, useEffect } from 'react'
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
import { useLeaveTypesQuery, useCreateRequestMutation } from '../hooks'

export function LeaveRequestDialog({ defaultEmployeeId }: { defaultEmployeeId?: string }) {
  const [open, setOpen] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [typeId, setTypeId] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [days, setDays] = useState('')
  const [reason, setReason] = useState('')

  const { data: employees } = useQuery({
    queryKey: ['employees', 'leave-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })
  const { data: types } = useLeaveTypesQuery({ isActive: true })
  const createMut = useCreateRequestMutation()

  useEffect(() => {
    if (!open) return
    setEmployeeId(defaultEmployeeId ?? '')
    setTypeId('')
    setStartDate(undefined)
    setEndDate(undefined)
    setDays('')
    setReason('')
  }, [open, defaultEmployeeId])

  function handleSubmit() {
    if (!employeeId) {
      toast.error('Select an employee')
      return
    }
    if (!typeId) {
      toast.error('Select a leave type')
      return
    }
    if (!startDate || !endDate) {
      toast.error('Select start and end dates')
      return
    }
    if (!reason.trim()) {
      toast.error('Enter a reason')
      return
    }
    const dto = {
      employeeId,
      typeId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      reason: reason.trim(),
      ...(days.trim() ? { days: Number(days) } : {}),
    }
    createMut.mutate(dto, { onSuccess: () => setOpen(false) })
  }

  const pending = createMut.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {defaultEmployeeId ? (
          <Button size='sm'>
            <span className='mr-1'>+</span> New Request
          </Button>
        ) : (
          <Button size='sm'>
            <span className='mr-1'>+</span> Add Request
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>New Leave Request</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
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
            <Label>Leave Type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger><SelectValue placeholder='Select leave type' /></SelectTrigger>
              <SelectContent>
                {(types || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Start Date</Label>
              <DatePicker selected={startDate} onSelect={setStartDate} placeholder='Pick start' />
            </div>
            <div className='grid gap-2'>
              <Label>End Date</Label>
              <DatePicker selected={endDate} onSelect={setEndDate} placeholder='Pick end' />
            </div>
          </div>
          <div className='grid gap-2'>
            <Label>Days (optional, auto-computed)</Label>
            <Input
              type='number'
              min={0}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder='Leave blank to auto-compute'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Reason</Label>
            <textarea
              className='min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='Reason for leave'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            Create Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
