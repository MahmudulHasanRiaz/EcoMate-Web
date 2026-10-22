import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PAYSLIP_STATUS_BADGE } from '@/features/payroll/components/payslip-status-badge'
import { formatDhakaDate } from '@/lib/dhaka-time'
import { useQuery } from '@tanstack/react-query'
import { myProfileApi } from '../api'
import type { PayslipItemResponse } from '@/features/payroll/api'

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

/**
 * Read-only payslip statement for the employee themself.
 *
 * The payroll admin dialog (features/payroll/components/payslip-detail.tsx)
 * cannot be reused here for two reasons:
 *   1. It fetched GET /payroll/payslips/:id, which is restricted to
 *      superadmin/admin/manager — so a plain `employee` got a 403 while the
 *      payslip list around it rendered fine.
 *   2. It offers Review / Approve actions. An employee has no business
 *      approving their own payslip.
 *
 * This reads GET /hr/my/payslips/:id, which is scoped to the caller's own
 * employee record on the server.
 */
export function MyPayslipDialog({
  open,
  onOpenChange,
  payslipId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  payslipId: string | null
}) {
  const { data: payslip, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-payslip', payslipId],
    queryFn: () => myProfileApi.getPayslip(payslipId!),
    enabled: !!payslipId && open,
    retry: false,
  })

  if (!payslipId) return null

  const badge = payslip ? PAYSLIP_STATUS_BADGE[payslip.status] : null
  const earnings = (payslip?.items ?? []).filter((i) => i.type === 'earnings')
  const deductions = (payslip?.items ?? []).filter((i) => i.type === 'deductions')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[620px]'>
        <DialogHeader>
          <DialogTitle>Payslip Statement</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Card>
            <CardContent className='py-16 flex justify-center'>
              <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className='py-16 text-center text-sm text-muted-foreground'>
              Could not load your payslip. Please try again.
              <button
                type='button'
                onClick={() => refetch()}
                className='ml-2 font-medium text-primary underline-offset-2 hover:underline'
              >
                Retry
              </button>
            </CardContent>
          </Card>
        ) : !payslip ? (
          <Card>
            <CardContent className='py-16 text-center text-sm text-muted-foreground'>
              Payslip not found.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <CardTitle>Payslip {payslip.periodKey ?? ''}</CardTitle>
                  <CardDescription>
                    {formatDhakaDate(payslip.periodStart)} – {formatDhakaDate(payslip.periodEnd)}
                  </CardDescription>
                </div>
                {badge && (
                  <Badge className={`border-transparent ${badge.className}`}>{badge.label}</Badge>
                )}
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
                  <p className='mt-1 font-semibold tabular-nums'>{formatMoney(payslip.netPay)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Convenience wrapper for callers that keep the id in their own state. */
export function MyPayslipDetail({ payslipId }: { payslipId: string | null }) {
  const [open, setOpen] = useState(true)
  return <MyPayslipDialog open={open} onOpenChange={setOpen} payslipId={payslipId} />
}