import { useState } from 'react'
import { Eye, ChevronRight } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCommissionReport, useCommissionDrilldown, useEarningDetail } from '../hooks'
import type { CommissionEmployeeTotal } from '../api'
import { money } from './money'

/**
 * Employee-wise commission report.
 *
 * Every percentage is shown with its numerator and denominator, because a rate
 * without the cohort size hides whether the number means anything.
 */
export function CommissionReportTable({
  employeeId,
  from,
  to,
}: {
  employeeId?: string
  from?: string
  to?: string
}) {
  const { data, isLoading, isError, refetch } = useCommissionReport({ employeeId, from, to })
  const [drill, setDrill] = useState<{ employee: CommissionEmployeeTotal; purpose?: string } | null>(null)

  if (isLoading) {
    return (
      <div className='grid gap-2'>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className='h-12 w-full' />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className='py-8 text-center'>
        <p className='text-sm text-destructive'>Could not load the commission report.</p>
        <Button variant='link' size='sm' onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const rows = data?.data ?? []
  const totals = data?.totals

  if (rows.length === 0) {
    return (
      <p className='py-8 text-center text-sm text-muted-foreground'>
        No commission has been earned in this period.
      </p>
    )
  }

  // Every action present in any row gets a column, so an employee who packs but
  // never confirms is still visible under Packed rather than dropped.
  const purposes = unionOfPurposes(rows)

  return (
    <>
      {totals && (
        <div className='mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <Card>
            <CardContent className='p-3'>
              <p className='text-xs text-muted-foreground'>Total Earned</p>
              <p className='text-xl font-bold tabular-nums'>{money(totals.totalEarned)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className='p-3'>
              <p className='text-xs text-muted-foreground'>Paid</p>
              <p className='text-xl font-bold tabular-nums text-emerald-600'>{money(totals.totalPaid)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className='p-3'>
              <p className='text-xs text-muted-foreground'>Unpaid</p>
              <p className='text-xl font-bold tabular-nums text-amber-600'>{money(totals.totalUnpaid)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className='p-3'>
              <p className='text-xs text-muted-foreground'>Employees</p>
              <p className='text-xl font-bold tabular-nums'>{totals.employeeCount}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className='overflow-x-auto'>
        <Table>
          <TableHeader className='bg-muted/30'>
            <TableRow>
              <TableHead>Employee</TableHead>
              {purposes.map((p) => (
                <TableHead key={p} className='text-right'>
                  {p}
                </TableHead>
              ))}
              <TableHead className='text-right'>Total Earned</TableHead>
              <TableHead className='text-right'>Paid</TableHead>
              <TableHead className='text-right'>Unpaid</TableHead>
              <TableHead className='w-[60px]' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              return (
                <TableRow key={row.employeeId}>
                  <TableCell>
                    <p className='text-sm font-medium'>{row.name}</p>
                    <p className='text-[11px] text-muted-foreground'>
                      {row.employeeCode ?? '—'}
                      {row.department ? ` · ${row.department}` : ''}
                    </p>
                  </TableCell>

                  {purposes.map((purpose) => {
                    const cell = row.byPurpose.find((p) => p.purpose === purpose)
                    return (
                      <TableCell key={purpose} className='text-right'>
                        {cell ? (
                          <button
                            type='button'
                            className='tabular-nums text-xs hover:underline'
                            onClick={() => setDrill({ employee: row, purpose })}
                            title={`${cell.count} orders`}
                          >
                            {money(cell.amount)}
                            <span className='block text-[10px] text-muted-foreground'>
                              {cell.count} order{cell.count === 1 ? '' : 's'}
                            </span>
                          </button>
                        ) : (
                          <span className='text-xs text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                    )
                  })}

                  <TableCell className='text-right font-semibold tabular-nums'>
                    {money(row.totalEarned)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums text-emerald-600'>
                    {money(row.paid)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums text-amber-600'>
                    {money(row.unpaid)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-8 w-8'
                      onClick={() => setDrill({ employee: row })}
                      title='View orders'
                    >
                      <Eye className='h-4 w-4' />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {drill && (
        <CommissionDrilldownDialog
          employee={drill.employee}
          purpose={drill.purpose}
          from={from}
          to={to}
          open
          onOpenChange={(o) => !o && setDrill(null)}
        />
      )}
    </>
  )
}

function unionOfPurposes(rows: CommissionEmployeeTotal[]): string[] {
  return [...new Set(rows.flatMap((r) => r.byPurpose.map((p) => p.purpose)))].sort()
}

/** Order-level drilldown: which orders produced this money. */
export function CommissionDrilldownDialog({
  employee,
  purpose,
  from,
  to,
  open,
  onOpenChange,
}: {
  employee: CommissionEmployeeTotal
  purpose?: string
  from?: string
  to?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useCommissionDrilldown({
    employeeId: employee.employeeId,
    purpose,
    from,
    to,
    page,
    perPage: 15,
  })

  const rows = data?.data ?? []
  const meta = data?.meta

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[860px] max-h-[85vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle>
            {purpose ? `${purpose} commission` : 'Commission'} — {employee.name}
          </DialogTitle>
          <DialogDescription>
            {meta ? `${meta.total} orders · ${money(meta.totalAmount)} total` : 'Loading…'}
          </DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {isLoading ? (
            <div className='grid gap-2'>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className='h-10 w-full' />
              ))}
            </div>
          ) : isError ? (
            <div className='py-8 text-center'>
              <p className='text-sm text-destructive'>Could not load the order records.</p>
              <Button variant='link' size='sm' onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              No orders in this cohort.
            </p>
          ) : (
            <Table>
              <TableHeader className='bg-muted/30'>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead className='text-right'>Order Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Commission</TableHead>
                  <TableHead className='w-[50px]' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.ledgerId}>
                    <TableCell className='font-mono text-xs font-semibold'>{r.displayId}</TableCell>
                    <TableCell className='text-right tabular-nums text-xs'>
                      {money(r.orderTotal)}
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-[10px]'>
                        {r.orderStatus ?? '—'}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right font-semibold tabular-nums'>
                      {money(r.amount)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-7 w-7'
                        title='Why was this paid?'
                        onClick={() => setSelected(r.ledgerId)}
                      >
                        <ChevronRight className='h-3.5 w-3.5' />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between border-t pt-3'>
            <p className='text-xs text-muted-foreground'>
              Page {meta.page} of {meta.totalPages}
            </p>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {selected && <EarningAuditDialog id={selected} onClose={() => setSelected(null)} />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The audit trail: why was this paid?
 *
 * Shows the SNAPSHOT taken at credit time rather than the rule's current
 * values, because the snapshot is what the money was actually calculated from.
 * A rule edited afterwards must not appear to justify a past payment.
 */
export function EarningAuditDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError } = useEarningDetail(id)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[640px] max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Why was this commission paid?</DialogTitle>
          <DialogDescription>
            Every input to the calculation, as it stood when the credit was recorded.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className='h-40 w-full' />
        ) : isError || !data ? (
          <p className='py-6 text-center text-sm text-destructive'>
            Could not load the audit trail.
          </p>
        ) : (
          <div className='grid gap-4 text-sm'>
            <section>
              <h4 className='mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Earned by
              </h4>
              <p>
                {data.employee.name}{' '}
                <span className='text-muted-foreground'>
                  ({data.employee.employeeCode}
                  {data.employee.department ? ` · ${data.employee.department}` : ''})
                </span>
              </p>
            </section>

            <section>
              <h4 className='mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Qualifying event
              </h4>
              <dl className='grid grid-cols-2 gap-x-3 gap-y-1'>
                <dt className='text-muted-foreground'>Order</dt>
                <dd className='font-mono font-semibold'>{data.order.displayId}</dd>
                <dt className='text-muted-foreground'>Action</dt>
                <dd>
                  {data.qualification.transitionFrom
                    ? `${data.qualification.transitionFrom} → ${data.qualification.transitionTo}`
                    : data.qualification.transitionTo}
                </dd>
                <dt className='text-muted-foreground'>First actor for this action</dt>
                <dd>
                  {data.qualification.isFirstActor ? (
                    <Badge variant='outline' className='text-[10px] text-emerald-600'>
                      Yes — credited
                    </Badge>
                  ) : (
                    <Badge variant='outline' className='text-[10px]'>
                      No
                    </Badge>
                  )}
                </dd>
                <dt className='text-muted-foreground'>When</dt>
                <dd>{new Date(data.qualification.qualifiedAt).toLocaleString()}</dd>
              </dl>
            </section>

            {data.qualification.threshold && (
              <section>
                <h4 className='mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                  Threshold
                </h4>
                <p>
                  {data.qualification.threshold.countAtQualification ?? '—'} of{' '}
                  {data.qualification.threshold.required} qualifying orders this{' '}
                  {data.qualification.threshold.period}
                  <span className='block text-xs text-muted-foreground'>
                    Period {data.qualification.threshold.periodKey}
                  </span>
                </p>
              </section>
            )}

            <section>
              <h4 className='mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Calculation (at the time)
              </h4>
              <dl className='grid grid-cols-2 gap-x-3 gap-y-1'>
                <dt className='text-muted-foreground'>Type</dt>
                <dd>{data.calculation.amountType === 'fixed' ? 'Fixed amount' : 'Percentage'}</dd>
                <dt className='text-muted-foreground'>
                  {data.calculation.amountType === 'fixed' ? 'Rate' : 'Rate'}
                </dt>
                <dd className='tabular-nums'>
                  {data.calculation.amountType === 'fixed'
                    ? money(data.calculation.ruleAmountAtTime)
                    : `${data.calculation.ruleAmountAtTime}%`}
                </dd>
                <dt className='text-muted-foreground'>Measured against</dt>
                <dd>
                  {data.calculation.valueBasis === 'subtotal' ? 'Subtotal' : 'Order total'} ={' '}
                  <span className='tabular-nums'>{money(data.calculation.sourceAmount)}</span>
                </dd>
                <dt className='text-muted-foreground'>Cap applied</dt>
                <dd>{data.calculation.capApplied ? 'Yes' : 'No'}</dd>
                <dt className='text-muted-foreground'>Commission</dt>
                <dd className='font-semibold tabular-nums'>{money(data.calculation.amount)}</dd>
              </dl>
            </section>

            {data.reversed > 0 && (
              <section>
                <h4 className='mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                  Reversals
                </h4>
                <p className='tabular-nums'>
                  Reversed {money(data.reversed)} · Net {money(data.net)}
                </p>
                <ul className='mt-1 grid gap-1 text-xs text-muted-foreground'>
                  {data.reversals.map((r) => (
                    <li key={r.id}>
                      {new Date(r.reversedAt).toLocaleDateString()} — {money(r.amount)} — {r.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.rule && Number(data.rule.currentAmount) !== data.calculation.ruleAmountAtTime && (
              <p className='rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'>
                The rule has since changed from {data.calculation.ruleAmountAtTime} to{' '}
                {data.rule.currentAmount}. This earning keeps the value that applied when it was
                credited.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}