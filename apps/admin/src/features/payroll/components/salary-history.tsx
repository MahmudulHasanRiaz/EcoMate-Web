import { RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { PayrollSummaryResponse, SalaryStructureResponse } from '../api'

// UTC-based so window rendering is deterministic regardless of server TZ.
const FD_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}

export function fmtWindowDate(date: string) {
  return new Date(date).toLocaleDateString('en-US', FD_OPTS)
}

export function formatSalaryAmount(value: number | string | null | undefined) {
  if (value == null) return '—'
  return `${Number(value).toLocaleString()} ৳`
}

export interface SalaryHistoryCardProps {
  structures: SalaryStructureResponse[]
  summary?: PayrollSummaryResponse
  mirrorSalary?: number | null
  pendingEffectiveFrom?: string
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
}

export function SalaryHistoryCard({
  structures,
  summary,
  mirrorSalary,
  pendingEffectiveFrom,
  isLoading,
  isError,
  onRetry,
}: SalaryHistoryCardProps) {
  const payslipCount = summary?.payslips?.length ?? 0

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Salary History</CardTitle>
          <CardDescription>
            Effective-dated salary windows for this employee.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {pendingEffectiveFrom && (
          <div className='flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'>
            <span className='font-medium'>
              New structure starts {fmtWindowDate(pendingEffectiveFrom)}
            </span>
          </div>
        )}
        <div className='rounded-lg border bg-muted/40 p-4 text-sm'>
          <div className='flex flex-wrap items-center gap-x-6 gap-y-2'>
            <span>
              Mirror (Employee.salary):{' '}
              <span className='font-semibold'>{formatSalaryAmount(mirrorSalary)}</span>
            </span>
            {summary && (
              <>
                <span>
                  {payslipCount} recent payslip{payslipCount === 1 ? '' : 's'}
                </span>
                <span>{formatSalaryAmount(summary.totalPaid)} paid</span>
                <span
                  className={
                    summary.outstanding > 0
                      ? 'font-semibold text-amber-600 dark:text-amber-400'
                      : undefined
                  }
                >
                  {formatSalaryAmount(summary.outstanding)} outstanding
                </span>
              </>
            )}
          </div>
        </div>

        {isLoading ? (
          <Skeleton className='h-24 w-full' />
        ) : isError ? (
          <div className='flex flex-col items-center gap-2 py-6 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load salary history.</p>
            {onRetry && (
              <Button variant='outline' size='sm' onClick={onRetry}>
                <RotateCcw className='h-3.5 w-3.5 mr-1' /> Retry
              </Button>
            )}
          </div>
        ) : structures.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            No salary history yet.
          </p>
        ) : (
          <div className='space-y-3'>
            {structures.map((structure) => (
              <div
                key={structure.id}
                className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3'
              >
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-medium'>
                    {fmtWindowDate(structure.effectiveFrom)} –{' '}
                    {structure.effectiveTo ? fmtWindowDate(structure.effectiveTo) : 'Present'}
                  </p>
                  <p className='mt-0.5 text-sm text-muted-foreground'>
                    Net: {formatSalaryAmount(structure.netSalary)}
                  </p>
                </div>
                {structure.isActive && (
                  <Badge className='bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'>
                    Active
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}