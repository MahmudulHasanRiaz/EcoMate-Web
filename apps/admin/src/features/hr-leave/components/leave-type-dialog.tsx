import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import {
  useCreateTypeMutation,
  useUpdateTypeMutation,
} from '../hooks'
import type { LeaveType } from '../api'

export function LeaveTypeDialog({ type }: { type?: LeaveType | null }) {
  const isEdit = !!type
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [daysPerYear, setDaysPerYear] = useState('')
  const [isPaid, setIsPaid] = useState(true)
  const [isActive, setIsActive] = useState(true)

  const createMut = useCreateTypeMutation()
  const updateMut = useUpdateTypeMutation()

  useEffect(() => {
    if (!open) return
    setName(type?.name ?? '')
    setCode(type?.code ?? '')
    setDaysPerYear(type ? String(type.daysPerYear) : '')
    setIsPaid(type?.isPaid ?? true)
    setIsActive(type?.isActive ?? true)
  }, [open, type])

  function num(value: string) {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  function handleSubmit() {
    if (!name.trim() || !code.trim()) {
      return
    }
    const dto = {
      name: name.trim(),
      code: code.trim(),
      daysPerYear: num(daysPerYear),
      isPaid,
      isActive,
    }
    if (isEdit && type) {
      updateMut.mutate({ id: type.id, dto }, { onSuccess: () => setOpen(false) })
    } else {
      createMut.mutate(dto, { onSuccess: () => setOpen(false) })
    }
  }

  const pending = createMut.isPending || updateMut.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant='ghost' size='sm'>Edit</Button>
        ) : (
          <Button size='sm'>
            <span className='mr-1'>+</span> Add Type
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Leave Type' : 'Add Leave Type'}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid gap-2'>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. Annual Leave' />
          </div>
          <div className='grid gap-2'>
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder='e.g. ANNUAL' />
          </div>
          <div className='grid gap-2'>
            <Label>Days Per Year</Label>
            <Input
              type='number'
              min={0}
              value={daysPerYear}
              onChange={(e) => setDaysPerYear(e.target.value)}
              placeholder='0'
            />
          </div>
          <div className='flex items-center justify-between rounded-lg border p-3'>
            <div>
              <Label>Paid Leave</Label>
              <p className='text-xs text-muted-foreground'>Employees are paid during this leave.</p>
            </div>
            <Switch checked={isPaid} onCheckedChange={setIsPaid} />
          </div>
          <div className='flex items-center justify-between rounded-lg border p-3'>
            <div>
              <Label>Active</Label>
              <p className='text-xs text-muted-foreground'>Inactive types cannot be requested.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            {isEdit ? 'Save Changes' : 'Create Type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
