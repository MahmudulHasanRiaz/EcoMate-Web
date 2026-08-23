import { useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import { useCreateDeductionMutation } from '../hooks'
import type { DeductionType } from '../api'

const DEDUCTION_TYPES: { value: DeductionType; label: string }[] = [
  { value: 'fine', label: 'Fine' },
  { value: 'other', label: 'Other' },
]

export function DeductionDialog({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<DeductionType>('fine')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [from, setFrom] = useState<Date | undefined>()
  const [to, setTo] = useState<Date | undefined>()

  const createMut = useCreateDeductionMutation(employeeId)

  function reset() {
    setType('fine')
    setAmount('')
    setReason('')
    setFrom(undefined)
    setTo(undefined)
  }

  function handleSubmit() {
    const numeric = Number(amount)
    if (!reason.trim() || !Number.isFinite(numeric) || numeric < 0) return
    createMut.mutate(
      {
        employeeId,
        type,
        amount: numeric,
        reason: reason.trim(),
        applicableFrom: from?.toISOString(),
        applicableTo: to?.toISOString(),
      },
      {
        onSuccess: () => {
          reset()
          setOpen(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); setOpen(o) }}>
      <DialogTrigger asChild>
        <Button size='sm'>
          <span className='mr-1'>+</span> Add Deduction
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>Add Deduction</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid gap-2'>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DeductionType)}>
              <SelectTrigger><SelectValue placeholder='Select type' /></SelectTrigger>
              <SelectContent>
                {DEDUCTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label>Amount (৳)</Label>
            <Input
              type='number'
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder='0.00'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Reason for deduction' />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Applicable From</Label>
              <DatePicker selected={from} onSelect={setFrom} placeholder='Optional' />
            </div>
            <div className='grid gap-2'>
              <Label>Applicable To</Label>
              <DatePicker selected={to} onSelect={setTo} placeholder='Optional' />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={createMut.isPending || !reason.trim() || Number(amount) < 0}
          >
            {createMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            Save Deduction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
