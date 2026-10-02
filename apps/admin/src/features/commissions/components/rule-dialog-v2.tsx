import { useEffect, useMemo, useState } from 'react'
import { Loader2, Info } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { employeesApi } from '@/features/employees/api'
import {
  COMMISSION_PURPOSES,
  THRESHOLD_PERIODS,
  VALUE_BASES,
  type CommissionAmountType,
  type CommissionPurpose,
  type CommissionRuleV2,
  type CommissionRuleV2Input,
  type ThresholdPeriod,
  type ValueBasis,
} from '../api'
import { useCreateRuleV2Mutation, useUpdateRuleV2Mutation } from '../hooks'

function useEmployeeOptions() {
  return useQuery({
    queryKey: ['employees', 'commission-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 200 }).then((r) => r.data.data),
  })
}

const NO_MIN = '__none__'

export function RuleDialogV2({ rule }: { rule?: CommissionRuleV2 | null }) {
  const isEdit = !!rule
  const [open, setOpen] = useState(false)

  const [employeeId, setEmployeeId] = useState('')
  const [purpose, setPurpose] = useState<CommissionPurpose>('Confirmed')
  const [amountType, setAmountType] = useState<CommissionAmountType>('fixed')
  const [amount, setAmount] = useState('')
  const [valueBasis, setValueBasis] = useState<ValueBasis>('order_total')
  const [useMinAmount, setUseMinAmount] = useState(false)
  const [minOrderAmount, setMinOrderAmount] = useState('')
  const [useCap, setUseCap] = useState(false)
  const [capPerOrder, setCapPerOrder] = useState('')
  const [useMinimumCount, setUseMinimumCount] = useState(false)
  const [minimumCount, setMinimumCount] = useState('')
  const [thresholdPeriod, setThresholdPeriod] = useState<ThresholdPeriod>('daily')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')

  const { data: employees } = useEmployeeOptions()
  const createMut = useCreateRuleV2Mutation()
  const updateMut = useUpdateRuleV2Mutation()

  useEffect(() => {
    if (!open) return
    setEmployeeId(rule?.employeeId ?? '')
    setPurpose((rule?.purpose as CommissionPurpose) ?? 'Confirmed')
    setAmountType(rule?.amountType ?? 'fixed')
    setAmount(rule ? String(rule.amount) : '')
    setValueBasis((rule?.valueBasis as ValueBasis) ?? 'order_total')
    setUseMinAmount(rule?.minOrderAmount != null)
    setMinOrderAmount(rule?.minOrderAmount != null ? String(rule.minOrderAmount) : '')
    setUseCap(rule?.capPerOrder != null)
    setCapPerOrder(rule?.capPerOrder != null ? String(rule.capPerOrder) : '')
    setUseMinimumCount(rule?.minimumCount != null)
    setMinimumCount(rule?.minimumCount != null ? String(rule.minimumCount) : '')
    setThresholdPeriod(rule?.thresholdPeriod ?? 'daily')
    setEffectiveFrom(rule?.effectiveFrom ? rule.effectiveFrom.slice(0, 10) : '')
    setEffectiveTo(rule?.effectiveTo ? rule.effectiveTo.slice(0, 10) : '')
  }, [open, rule])

  const num = (v: string) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const payload = useMemo((): CommissionRuleV2Input | null => {
    if (!employeeId) return null
    const parsedAmount = num(amount)
    if (parsedAmount === null || parsedAmount <= 0) return null

    return {
      employeeId,
      purpose,
      amountType,
      amount: parsedAmount,
      valueBasis,
      minOrderAmount: useMinAmount ? num(minOrderAmount) : null,
      capPerOrder: useCap ? num(capPerOrder) : null,
      minimumCount: useMinimumCount ? num(minimumCount) : null,
      thresholdPeriod: useMinimumCount ? thresholdPeriod : null,
      effectiveFrom: effectiveFrom || null,
      effectiveTo: effectiveTo || null,
    }
  }, [
    employeeId, purpose, amountType, amount, valueBasis,
    useMinAmount, minOrderAmount, useCap, capPerOrder,
    useMinimumCount, minimumCount, thresholdPeriod, effectiveFrom, effectiveTo,
  ])

  /**
   * Plain-language preview of what this rule will do. Rendered before saving so
   * the admin reads exactly what they are configuring — including the threshold
   * rule, which is the part most easily misunderstood.
   */
  const summary = useMemo(() => {
    const employeeName = employees?.find((e) => e.id === employeeId)?.betterAuthUser?.name
    const a = num(amount)
    if (!employeeName || a === null || a <= 0) return null

    const value =
      amountType === 'fixed'
        ? `৳${a.toFixed(2)} per qualifying ${purpose} order`
        : `${a.toFixed(2)}% of the ${valueBasis === 'subtotal' ? 'subtotal' : 'order total'} for each qualifying ${purpose} order`

    const parts: string[] = [`${employeeName} earns ${value}`]

    const min = useMinimumCount ? num(minimumCount) : null
    if (min !== null && min > 0) {
      parts.push(
        `after completing ${min} qualifying ${purpose} orders each ${thresholdPeriod} ` +
          `(the first ${min} do not pay; commission starts from #${min + 1})`,
      )
    }
    const minAmt = useMinAmount ? num(minOrderAmount) : null
    if (minAmt !== null) parts.push(`for orders of at least ৳${minAmt.toFixed(2)}`)
    const cap = useCap ? num(capPerOrder) : null
    if (cap !== null) parts.push(`(capped at ৳${cap.toFixed(2)} per order)`)

    return parts.join(' ') + '.'
  }, [
    employees, employeeId, amount, amountType, purpose, valueBasis,
    useMinimumCount, minimumCount, thresholdPeriod, useMinAmount, minOrderAmount,
    useCap, capPerOrder,
  ])

  const canSave = !!payload && !createMut.isPending && !updateMut.isPending

  function handleSubmit() {
    if (!payload) return
    const mutate = isEdit && rule ? updateMut.mutate : createMut.mutate
    if (isEdit && rule) {
      updateMut.mutate({ id: rule.id, dto: payload }, { onSuccess: () => setOpen(false) })
    } else {
      createMut.mutate(payload, { onSuccess: () => setOpen(false) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit && rule ? (
          <span />
        ) : (
          <Button>
            <Info className='me-2 h-4 w-4' />
            New Commission Rule
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className='sm:max-w-[620px] max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Commission Rule' : 'New Commission Rule'}</DialogTitle>
          <DialogDescription>
            Commission is credited to whoever FIRST moves an order into this action. A second
            person doing the same action on the same order earns nothing for it.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          <div className='grid gap-2'>
            <Label htmlFor='cr-employee'>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={isEdit}>
              <SelectTrigger id='cr-employee'>
                <SelectValue placeholder='Select an employee' />
              </SelectTrigger>
              <SelectContent>
                {(employees ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.betterAuthUser?.name ?? e.employeeId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='cr-purpose'>Commission For</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as CommissionPurpose)}>
              <SelectTrigger id='cr-purpose'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_PURPOSES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label} — {p.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='grid gap-2'>
            <Label>Commission Type</Label>
            <RadioGroup
              value={amountType}
              onValueChange={(v) => setAmountType(v as CommissionAmountType)}
              className='flex gap-4'
            >
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='fixed' id='cr-type-fixed' />
                <Label htmlFor='cr-type-fixed' className='font-normal'>
                  Fixed Amount
                </Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='percent' id='cr-type-percent' />
                <Label htmlFor='cr-type-percent' className='font-normal'>
                  Percentage
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='cr-amount'>
              {amountType === 'fixed' ? 'Amount per qualifying order (৳)' : 'Percentage (%)'}
            </Label>
            <Input
              id='cr-amount'
              type='number'
              min='0'
              step='0.01'
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={amountType === 'fixed' ? '10' : '1.00'}
            />
          </div>

          {amountType === 'percent' && (
            <div className='grid gap-2'>
              <Label htmlFor='cr-basis'>Percentage is measured against</Label>
              <Select value={valueBasis} onValueChange={(v) => setValueBasis(v as ValueBasis)}>
                <SelectTrigger id='cr-basis'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VALUE_BASES.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ── Threshold: a COUNT of qualifying orders, per period ── */}
          <div className='grid gap-3 rounded-lg border p-3'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id='cr-use-min-count'
                checked={useMinimumCount}
                onCheckedChange={(v) => setUseMinimumCount(!!v)}
              />
              <Label htmlFor='cr-use-min-count' className='font-normal'>
                Require a minimum number of qualifying orders before paying
              </Label>
            </div>

            {useMinimumCount && (
              <div className='grid gap-3 ps-6'>
                <div className='grid gap-2'>
                  <Label htmlFor='cr-min-count'>Minimum qualifying orders</Label>
                  <Input
                    id='cr-min-count'
                    type='number'
                    min='1'
                    step='1'
                    value={minimumCount}
                    onChange={(e) => setMinimumCount(e.target.value)}
                    placeholder='50'
                  />
                </div>
                <div className='grid gap-2'>
                  <Label htmlFor='cr-period'>Period</Label>
                  <Select
                    value={thresholdPeriod}
                    onValueChange={(v) => setThresholdPeriod(v as ThresholdPeriod)}
                  >
                    <SelectTrigger id='cr-period'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {THRESHOLD_PERIODS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className='text-xs text-muted-foreground'>
                  The first {minimumCount || 'N'} qualifying {purpose} orders each {thresholdPeriod} only
                  qualify — they do not pay. Commission starts from order #{minimumCount ? Number(minimumCount) + 1 : 'N+1'}.
                  Counts are tracked per employee, per action, in Dhaka time.
                </p>
              </div>
            )}
          </div>

          {/* ── Optional per-order amount gate: a DIFFERENT condition ── */}
          <div className='grid gap-3 rounded-lg border p-3'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id='cr-use-min-amount'
                checked={useMinAmount}
                onCheckedChange={(v) => setUseMinAmount(!!v)}
              />
              <Label htmlFor='cr-use-min-amount' className='font-normal'>
                Only pay on orders above a minimum amount
              </Label>
            </div>
            {useMinAmount && (
              <div className='grid gap-2 ps-6'>
                <Label htmlFor='cr-min-amount'>Minimum order amount (৳)</Label>
                <Input
                  id='cr-min-amount'
                  type='number'
                  min='0'
                  step='0.01'
                  value={minOrderAmount}
                  onChange={(e) => setMinOrderAmount(e.target.value)}
                  placeholder='500'
                />
              </div>
            )}
          </div>

          <div className='grid gap-3 rounded-lg border p-3'>
            <div className='flex items-center gap-2'>
              <Checkbox id='cr-use-cap' checked={useCap} onCheckedChange={(v) => setUseCap(!!v)} />
              <Label htmlFor='cr-use-cap' className='font-normal'>
                Cap the commission for a single order
              </Label>
            </div>
            {useCap && (
              <div className='grid gap-2 ps-6'>
                <Label htmlFor='cr-cap'>Maximum commission per order (৳)</Label>
                <Input
                  id='cr-cap'
                  type='number'
                  min='0'
                  step='0.01'
                  value={capPerOrder}
                  onChange={(e) => setCapPerOrder(e.target.value)}
                  placeholder='100'
                />
              </div>
            )}
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label htmlFor='cr-from'>Start date (optional)</Label>
              <Input
                id='cr-from'
                type='date'
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='cr-to'>End date (optional)</Label>
              <Input
                id='cr-to'
                type='date'
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </div>
          </div>

          {summary && (
            <div className='rounded-lg border border-primary/25 bg-primary/5 p-3'>
              <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1'>
                What this rule does
              </p>
              <p className='text-sm leading-relaxed'>{summary}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSave}>
            {(createMut.isPending || updateMut.isPending) && (
              <Loader2 className='me-2 h-4 w-4 animate-spin' />
            )}
            {isEdit ? 'Save Changes' : 'Create Rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Small wrapper so the row action can open the same dialog pre-filled. */
export function EditRuleDialog({ rule, trigger }: { rule: CommissionRuleV2; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className='sm:max-w-[620px]'>
        <DialogHeader>
          <DialogTitle>Edit Commission Rule</DialogTitle>
        </DialogHeader>
        <RuleEditBody rule={rule} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function RuleEditBody({ rule, onDone }: { rule: CommissionRuleV2; onDone: () => void }) {
  const updateMut = useUpdateRuleV2Mutation()
  return (
    <div className='grid gap-3'>
      <p className='text-sm text-muted-foreground'>{rule.summary}</p>
      <p className='text-xs text-muted-foreground'>
        Editing a rule only affects future qualifying orders. Earnings already recorded keep the
        values that were in force when they were credited.
      </p>
      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={onDone}>
          Close
        </Button>
        <Button
          disabled={updateMut.isPending}
          onClick={() =>
            updateMut.mutate(
              { id: rule.id, dto: { isActive: !rule.isActive } },
              { onSuccess: onDone },
            )
          }
        >
          {rule.isActive ? 'Deactivate' : 'Reactivate'}
        </Button>
      </div>
    </div>
  )
}