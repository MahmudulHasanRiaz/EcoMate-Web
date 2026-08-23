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
import { useQuery } from '@tanstack/react-query'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import {
  useCreateRuleMutation,
  useUpdateRuleMutation,
} from '../hooks'
import type { CommissionRule, CommissionAmountType } from '../api'

const AMOUNT_TYPES: { value: CommissionAmountType; label: string }[] = [
  { value: 'fixed', label: 'Fixed (৳)' },
  { value: 'percent', label: 'Percent (%)' },
]

function useEmployeeOptions() {
  return useQuery({
    queryKey: ['employees', 'commission-picker'],
    queryFn: () =>
      employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })
}

export function RuleDialog({
  rule,
}: {
  rule?: CommissionRule | null
}) {
  const isEdit = !!rule
  const [open, setOpen] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [amountType, setAmountType] = useState<CommissionAmountType>('fixed')
  const [amount, setAmount] = useState('')
  const [minOrderAmount, setMinOrderAmount] = useState('')
  const [capPerOrder, setCapPerOrder] = useState('')

  const { data: employees } = useEmployeeOptions()
  const createMut = useCreateRuleMutation()
  const updateMut = useUpdateRuleMutation()

  useEffect(() => {
    if (!open) return
    setEmployeeId(rule?.employeeId ?? '')
    setAmountType(rule?.amountType ?? 'fixed')
    setAmount(rule ? String(rule.amount) : '')
    setMinOrderAmount(rule?.minOrderAmount != null ? String(rule.minOrderAmount) : '')
    setCapPerOrder(rule?.capPerOrder != null ? String(rule.capPerOrder) : '')
  }, [open, rule])

  function num(value: string) {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  function handleSubmit() {
    if (isEdit && rule) {
      updateMut.mutate(
        {
          id: rule.id,
          dto: {
            amountType,
            amount: num(amount),
            minOrderAmount: minOrderAmount ? num(minOrderAmount) : undefined,
            capPerOrder: capPerOrder ? num(capPerOrder) : undefined,
          },
        },
        { onSuccess: () => setOpen(false) },
      )
    } else {
      if (!employeeId) {
        toastError('Select an employee')
        return
      }
      createMut.mutate(
        {
          employeeId,
          amountType,
          amount: num(amount),
          minOrderAmount: minOrderAmount ? num(minOrderAmount) : undefined,
          capPerOrder: capPerOrder ? num(capPerOrder) : undefined,
        },
        { onSuccess: () => setOpen(false) },
      )
    }
  }

  function toastError(msg: string) {
    toast.error(msg)
  }

  const pending = createMut.isPending || updateMut.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant='ghost' size='sm'>Edit</Button>
        ) : (
          <Button size='sm'>
            <span className='mr-1'>+</span> Add Rule
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Commission Rule' : 'Add Commission Rule'}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='grid gap-2'>
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={isEdit}>
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
            <Label>Amount Type</Label>
            <Select value={amountType} onValueChange={(v) => setAmountType(v as CommissionAmountType)}>
              <SelectTrigger><SelectValue placeholder='Select type' /></SelectTrigger>
              <SelectContent>
                {AMOUNT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-2'>
            <Label>{amountType === 'percent' ? 'Percentage (%)' : 'Amount (৳)'}</Label>
            <Input
              type='number'
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder='0'
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label>Min Order Amount (৳)</Label>
              <Input
                type='number'
                min={0}
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
                placeholder='Optional'
              />
            </div>
            <div className='grid gap-2'>
              <Label>Cap Per Order (৳)</Label>
              <Input
                type='number'
                min={0}
                value={capPerOrder}
                onChange={(e) => setCapPerOrder(e.target.value)}
                placeholder='Optional'
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
            {isEdit ? 'Save Changes' : 'Create Rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
