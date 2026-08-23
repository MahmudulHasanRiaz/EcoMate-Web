import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { PAYSLIP_STATUS_BADGE } from './payslip-status-badge'
import { usePayslipQuery, useSetPayslipStatusMutation } from '../hooks'
import type { PayslipItemResponse } from '../api'

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

function ItemRows({
  title,
  items,
  empty,
}: {
  title: string
  items: PayslipItemResponse[]
  empty: string
}) {
  const subtotal = items.reduce((s, i) => s + Number(i.amount), 0)
  return (
    <>
      <TableRow className='bg-muted/40'>
        <TableCell colSpan={2} className='font-semibold text-sm'>{title}</TableCell>
        <TableCell className='text-right font-semibold tabular-nums'>{formatMoney(subtotal)}</TableCell>
      </TableRow>
      {items.length === 0 ? (
        <TableRow>
          <TableCell colSpan={3} className='text-sm text-muted-foreground'>{empty}</TableCell>
        </TableRow>
      ) : (
        items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className='pl-6'>{item.label}</TableCell>
            <TableCell className='text-muted-foreground text-xs'>{item.type}</TableCell>
            <TableCell className='text-right tabular-nums'>{formatMoney(item.amount)}</TableCell>
          </TableRow>
        ))
      )}
    </>
  )
}

export function PayslipDetail({ payslipId }: { payslipId: string }) {
  const { data: payslip, isLoading } = usePayslipQuery(payslipId)
  const employeeId = payslip?.employeeId ?? ''
  const statusMut = useSetPayslipStatusMutation(employeeId)

  if (isLoading) {
    return (
      <Card>
        <CardContent className='py-16 flex justify-center'>
          <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
        </CardContent>
      </Card>
    )
  }

  if (!payslip) {
    return (
      <Card>
        <CardContent className='py-16 text-center text-sm text-muted-foreground'>
          Could not load payslip.
        </CardContent>
      </Card>
    )
  }

  const badge = PAYSLIP_STATUS_BADGE[payslip.status]
  const earnings = (payslip.items ?? []).filter((i) => i.type === 'earnings')
  const deductions = (payslip.items ?? []).filter((i) => i.type === 'deductions')
  const isDraftOrReviewed = payslip.status === 'draft' || payslip.status === 'reviewed'
  const isApproved = payslip.status === 'approved'

  function handleReview() {
    if (!payslip) return
    statusMut.mutate({ id: payslip.id, status: 'reviewed' })
  }

  function handleApprove() {
    if (!payslip) return
    if (!window.confirm('Approve this payslip? Approved payslips become locked.'))
      return
    statusMut.mutate({ id: payslip.id, status: 'approved' })
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Payslip {payslip.periodKey ?? ''}</CardTitle>
            <CardDescription>
              {formatDate(payslip.periodStart)} – {formatDate(payslip.periodEnd)}
            </CardDescription>
          </div>
          <Badge className={`border-transparent ${badge.className}`}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className='text-right'>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <ItemRows title='Earnings' items={earnings} empty='No earnings' />
            <ItemRows title='Deductions' items={deductions} empty='No deductions' />
          </TableBody>
        </Table>

        <div className='grid grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-4 text-sm'>
          <div>
            <p className='text-muted-foreground'>Total Earnings</p>
            <p className='mt-1 font-semibold tabular-nums'>{formatMoney(payslip.totalEarnings)}</p>
          </div>
          <div>
            <p className='text-muted-foreground'>Total Deductions</p>
            <p className='mt-1 font-semibold tabular-nums'>{formatMoney(payslip.totalDeductions)}</p>
          </div>
          <div>
            <p className='text-muted-foreground'>Net Pay</p>
            <p className='mt-1 text-lg font-bold tabular-nums'>{formatMoney(payslip.netPay)}</p>
          </div>
        </div>

        {isDraftOrReviewed && (
          <div className='flex flex-wrap items-center gap-2'>
            {payslip.status === 'draft' && (
              <Button
                size='sm'
                variant='outline'
                disabled={statusMut.isPending}
                onClick={handleReview}
              >
                {statusMut.isPending && statusMut.variables?.status === 'reviewed' && (
                  <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' />
                )}
                Mark Reviewed
              </Button>
            )}
            {payslip.status === 'reviewed' && (
              <Button
                size='sm'
                disabled={statusMut.isPending}
                onClick={handleApprove}
              >
                {statusMut.isPending && statusMut.variables?.status === 'approved' && (
                  <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' />
                )}
                Approve
              </Button>
            )}
          </div>
        )}

        {isApproved && (
          <p className='text-xs text-muted-foreground'>
            This payslip is approved and locked. Payments can now be recorded.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
