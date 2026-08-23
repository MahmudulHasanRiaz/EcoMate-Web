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
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/date-picker'
import { useGeneratePayslipMutation } from '../hooks'

export function PayslipDialog({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false)
  const [periodStart, setPeriodStart] = useState<Date | undefined>()
  const [periodEnd, setPeriodEnd] = useState<Date | undefined>()

  const generateMut = useGeneratePayslipMutation(employeeId)

  function reset() {
    setPeriodStart(undefined)
    setPeriodEnd(undefined)
  }

  function handleSubmit() {
    if (!periodStart || !periodEnd) return
    generateMut.mutate(
      {
        employeeId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
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
          <span className='mr-1'>+</span> Generate Payslip
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>Generate Payslip</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid gap-2'>
            <Label>Period Start</Label>
            <DatePicker
              selected={periodStart}
              onSelect={setPeriodStart}
              placeholder='Pick start date'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Period End</Label>
            <DatePicker
              selected={periodEnd}
              onSelect={setPeriodEnd}
              placeholder='Pick end date'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={generateMut.isPending || !periodStart || !periodEnd}
          >
            {generateMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
