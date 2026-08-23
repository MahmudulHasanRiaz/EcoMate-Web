import { useState } from 'react'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
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
import { PAYSLIP_STATUS_BADGE } from './payslip-status-badge'
import {
  usePayslipsQuery,
  usePaymentsQuery,
  useCreatePaymentMutation,
  useDeletePaymentMutation,
} from '../hooks'
import type { PaymentMethod, PayslipResponse } from '../api'

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

const METHODS: PaymentMethod[] = ['Cash', 'Bank', 'Check', 'Mobile']

export function PaymentsPanel({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = usePayslipsQuery({ employeeId })
  const [selectedPayslipId, setSelectedPayslipId] = useState<string | null>(null)

  const rows: PayslipResponse[] = Array.isArray(data?.data) ? data.data : []
  const selected = rows.find((r) => r.id === selectedPayslipId) ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          Select an approved payslip to record or review payments.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load payslips.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>
            No payslips yet. Generate one from the Payroll tab.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Range</TableHead>
                <TableHead className='text-right'>Net Pay</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const badge = PAYSLIP_STATUS_BADGE[row.status]
                const active = row.id === selectedPayslipId
                return (
                  <TableRow
                    key={row.id}
                    onClick={() => setSelectedPayslipId(row.id)}
                    className={active ? 'cursor-pointer bg-muted/50' : 'cursor-pointer'}
                  >
                    <TableCell className='font-medium'>{row.periodKey ?? '—'}</TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>{formatMoney(row.netPay)}</TableCell>
                    <TableCell>
                      <Badge className={`border-transparent ${badge.className}`}>{badge.label}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {selected && (
          <PaymentsForPayslip key={selected.id} employeeId={employeeId} payslip={selected} />
        )}
      </CardContent>
    </Card>
  )
}

function PaymentsForPayslip({
  employeeId,
  payslip,
}: {
  employeeId: string
  payslip: PayslipResponse
}) {
  const { data: payments, isLoading, isError, refetch } = usePaymentsQuery(payslip.id)
  const createMut = useCreatePaymentMutation(employeeId, payslip.id)
  const deleteMut = useDeletePaymentMutation(employeeId, payslip.id)

  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('Cash')
  const [referenceNo, setReferenceNo] = useState('')
  const [note, setNote] = useState('')

  const list = Array.isArray(payments) ? payments : []
  const totalPaid = list.reduce((s, p) => s + Number(p.amount), 0)
  const locked = payslip.status === 'paid'
  const canRecord = !['draft', 'reviewed', 'cancelled', 'paid'].includes(payslip.status)

  function reset() {
    setAmount('')
    setMethod('Cash')
    setReferenceNo('')
    setNote('')
  }

  function handleSubmit() {
    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric <= 0) return
    createMut.mutate(
      {
        amount: numeric,
        method,
        referenceNo: referenceNo.trim() || undefined,
        note: note.trim() || undefined,
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
    <div className='space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <p className='text-sm font-medium'>
            Paid {formatMoney(totalPaid)} of {formatMoney(payslip.netPay)}
          </p>
          {totalPaid > 0 && totalPaid < Number(payslip.netPay) && (
            <p className='text-xs text-muted-foreground'>
              Remaining {formatMoney(Number(payslip.netPay) - totalPaid)}
            </p>
          )}
        </div>
        <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); setOpen(o) }}>
          <DialogTrigger asChild>
            <Button size='sm' disabled={!canRecord}>
              Record Payment
            </Button>
          </DialogTrigger>
          <DialogContent className='sm:max-w-[520px]'>
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>
            <div className='grid gap-4 py-4'>
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
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger><SelectValue placeholder='Select method' /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-2'>
                <Label>Reference No.</Label>
                <Input
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder='Optional'
                />
              </div>
              <div className='grid gap-2'>
                <Label>Note</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder='Optional'
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={createMut.isPending || !Number.isFinite(Number(amount)) || Number(amount) <= 0}
              >
                {createMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                Record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!canRecord && (
        <p className='text-xs text-muted-foreground'>
          {locked
            ? 'This payslip is fully paid and locked.'
            : 'Payslip must be approved before payments can be recorded.'}
        </p>
      )}

      {isLoading ? (
        <div className='flex justify-center py-6'>
          <Loader2 className='animate-spin h-5 w-5 text-muted-foreground' />
        </div>
      ) : isError ? (
        <div className='flex flex-col items-center gap-3 py-6 text-center'>
          <p className='text-sm text-muted-foreground'>Could not load payments.</p>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            <RotateCcw className='h-4 w-4 mr-1' /> Retry
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p className='py-4 text-center text-sm text-muted-foreground'>No payments recorded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paid At</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className='text-right'>Amount</TableHead>
              <TableHead className='w-16' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => (
              <TableRow key={p.id}>
                <TableCell className='text-sm'>{formatDate(p.paidAt)}</TableCell>
                <TableCell>{p.method ?? '—'}</TableCell>
                <TableCell className='text-muted-foreground'>{p.referenceNo ?? '—'}</TableCell>
                <TableCell className='text-right tabular-nums'>{formatMoney(p.amount)}</TableCell>
                <TableCell>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    disabled={locked || deleteMut.isPending}
                    onClick={() => deleteMut.mutate(p.id)}
                    title='Reverse payment'
                  >
                    {deleteMut.isPending && deleteMut.variables === p.id ? (
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                    ) : (
                      <Trash2 className='h-3.5 w-3.5 text-rose-600 dark:text-rose-400' />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
