import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { employeesApi } from '@/features/employees/api'
import {
  useCommissionEarningsQuery,
  useReverseEarningMutation,
} from '../hooks'
import type { CommissionEarningRow } from '../api'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatMoney(n?: number | null) {
  return `${Number(n ?? 0).toLocaleString()} ৳`
}

function ruleLabel(rule?: CommissionEarningRow['rule'] | null) {
  if (!rule) return '—'
  return rule.amountType === 'percent'
    ? `${Number(rule.amount)}%`
    : `${Number(rule.amount).toLocaleString()} ৳`
}

function EmployeeFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { data } = useQuery({
    queryKey: ['employees', 'earnings-filter'],
    queryFn: () => employeesApi.list({ perPage: 100 }).then((r) => r.data),
  })
  const employees = Array.isArray(data?.data) ? data.data : []
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className='w-56' aria-label='Filter by employee'>
        <SelectValue placeholder='All employees' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='all'>All employees</SelectItem>
        {employees.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.employeeId} · {e.betterAuthUser?.name || '—'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ReverseDialog({
  earning,
  onOpenChange,
}: {
  earning: CommissionEarningRow | null
  onOpenChange: (o: boolean) => void
}) {
  const reverseMut = useReverseEarningMutation()
  const [reason, setReason] = useState('')
  const [refunded, setRefunded] = useState('')
  const open = !!earning

  function reset() {
    setReason('')
    setRefunded('')
  }

  function handleConfirm() {
    if (!earning || !reason.trim()) return
    reverseMut.mutate(
      {
        id: earning.id,
        dto: {
          reason: reason.trim(),
          refundedAmount: refunded.trim() ? Number(refunded) : undefined,
        },
      },
      {
        onSuccess: () => {
          reset()
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className='sm:max-w-[520px]'>
        <DialogHeader>
          <DialogTitle>Reverse Commission</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-4 text-sm'>
          <p className='text-muted-foreground'>
            Reversing the {formatMoney(earning?.amount)} commission for order{' '}
            {earning?.order?.displayId || earning?.orderId}. The original
            earning stays immutable; an auditable reversal row is recorded.
          </p>
          <div className='grid gap-2'>
            <Label>Reason (required)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='e.g. Order cancelled by customer'
              aria-label='Reversal reason'
            />
          </div>
          <div className='grid gap-2'>
            <Label>Refunded Amount (৳) — optional, for partial refunds</Label>
            <Input
              type='number'
              min={0}
              value={refunded}
              onChange={(e) => setRefunded(e.target.value)}
              placeholder='0.00'
              aria-label='Refunded amount'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={reverseMut.isPending || !reason.trim()}
          >
            {reverseMut.isPending && (
              <Loader2 className='h-4 w-4 animate-spin mr-1' />
            )}
            Reverse
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function reverseReasonTitle(row: CommissionEarningRow) {
  const reasons = (row.reversals ?? []).map((r) => r.reason).filter(Boolean)
  return reasons.length > 0 ? `Reversed: ${reasons.join('; ')}` : 'Reversed'
}

export function EarningsTable({
  employeeId,
  showEmployeeFilter = true,
}: {
  employeeId?: string
  showEmployeeFilter?: boolean
}) {
  const [page, setPage] = useState(1)
  const [empFilter, setEmpFilter] = useState<string>(
    employeeId && !showEmployeeFilter ? employeeId : 'all',
  )
  const [reversed, setReversed] = useState<string>('')
  const [inPayroll, setInPayroll] = useState<string>('')
  const [reverseTarget, setReverseTarget] = useState<CommissionEarningRow | null>(null)

  const effEmpId =
    !showEmployeeFilter && employeeId
      ? employeeId
      : empFilter === 'all'
        ? undefined
        : empFilter

  const { data, isLoading, isError, refetch } = useCommissionEarningsQuery({
    employeeId: effEmpId,
    reversed: reversed || undefined,
    inPayroll: inPayroll || undefined,
    page,
  })

  const rows: CommissionEarningRow[] = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta
  const totals = meta?.totals

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <CardTitle>Commission Earnings</CardTitle>
            <CardDescription>
              Approved commission payouts and reversal records.
            </CardDescription>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {showEmployeeFilter && (
              <EmployeeFilter value={empFilter} onChange={setEmpFilter} />
            )}
            <Select value={reversed} onValueChange={setReversed}>
              <SelectTrigger className='w-40' aria-label='Filter by reversal status'>
                <SelectValue placeholder='All reversal statuses' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=''>All reversal statuses</SelectItem>
                <SelectItem value='true'>Reversed</SelectItem>
                <SelectItem value='false'>Not reversed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={inPayroll} onValueChange={setInPayroll}>
              <SelectTrigger className='w-40' aria-label='Filter by payroll status'>
                <SelectValue placeholder='All payroll statuses' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=''>All payroll statuses</SelectItem>
                <SelectItem value='true'>In payroll</SelectItem>
                <SelectItem value='false'>Not in payroll</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {totals && (
          <div className='mt-2 flex flex-wrap items-center gap-3 border-t pt-3 text-sm'>
            <span className='text-muted-foreground'>Total:</span>
            <span className='font-semibold tabular-nums'>
              {formatMoney(totals.totalCommission)}
            </span>
            <span className='text-rose-600 dark:text-rose-400 tabular-nums'>
              − Reversed {formatMoney(totals.totalReversed)}
            </span>
            <span className='ml-1 font-bold tabular-nums'>
              Net payable {formatMoney(totals.netPayable)}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>
              Could not load commission earnings.
            </p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>
            No commission earnings to show.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='w-24'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isRev = (row.reversals ?? []).length > 0
                return (
                  <TableRow
                    key={row.id}
                    className={isRev ? 'opacity-60' : undefined}
                  >
                    <TableCell className='text-sm text-muted-foreground'>
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell className='font-medium truncate'>
                      {row.order?.displayId || row.orderId}
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {ruleLabel(row.rule)}
                    </TableCell>
                    <TableCell className='text-right font-medium tabular-nums'>
                      {formatMoney(row.amount)}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap items-center gap-1'>
                        <Badge className='border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'>
                          Approved
                        </Badge>
                        {isRev && (
                          <Badge
                            title={reverseReasonTitle(row)}
                            className='border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          >
                            Reversed
                          </Badge>
                        )}
                        {row.payslipId && (
                          <Badge className='border-transparent bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'>
                            In Payroll
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={isRev}
                        onClick={() => setReverseTarget(row)}
                        title={isRev ? 'Already reversed' : 'Reverse commission'}
                      >
                        Reverse
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between border-t px-2 py-2'>
            <p className='text-sm text-muted-foreground'>{meta.total} total</p>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                className='h-8 w-8 p-0'
                disabled={meta.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <span className='sr-only'>Previous</span>‹
              </Button>
              <span className='text-sm text-muted-foreground'>
                Page {meta.page} of {meta.totalPages}
              </span>
              <Button
                variant='outline'
                className='h-8 w-8 p-0'
                disabled={meta.page >= meta.totalPages}
                onClick={() =>
                  setPage((p) => Math.min(meta.totalPages, p + 1))
                }
              >
                <span className='sr-only'>Next</span>›
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <ReverseDialog earning={reverseTarget} onOpenChange={setReverseTarget} />
    </Card>
  )
}

/** Back-compat wrapper used by the employee detail page (fixed employee). */
export function CommissionEarningsTab({
  employeeId,
  page: _page,
}: {
  employeeId: string
  page?: number
}) {
  return <EarningsTable employeeId={employeeId} showEmployeeFilter={false} />
}
