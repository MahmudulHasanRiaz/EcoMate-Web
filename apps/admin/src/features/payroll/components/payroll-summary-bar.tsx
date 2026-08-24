import type { PayslipListSummary } from '../api'

function formatMoney(n?: number | null) {
  return `${Number(n ?? 0).toLocaleString()} ৳`
}

function Stat({
  label,
  value,
  variant,
}: {
  label: string
  value: React.ReactNode
  variant?: 'rose' | 'emerald'
}) {
  return (
    <div className='rounded-lg border bg-card p-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          variant === 'rose'
            ? 'text-destructive'
            : variant === 'emerald'
              ? 'text-emerald-600 dark:text-emerald-400'
              : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}

export function PayrollSummaryBar({
  summary,
}: {
  summary?: PayslipListSummary | null
}) {
  if (!summary) return null
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7'>
      <Stat label='Employees' value={summary.employeeCount} />
      <Stat label='Gross Earnings' value={formatMoney(summary.totalEarnings)} />
      <Stat label='Commission' value={formatMoney(summary.totalCommission)} />
      <Stat label='Deductions' value={formatMoney(summary.totalDeductions)} variant='rose' />
      <Stat label='Net Pay' value={formatMoney(summary.netPay)} />
      <Stat label='Paid' value={formatMoney(summary.totalPaid)} variant='emerald' />
      <Stat label='Outstanding' value={formatMoney(summary.outstanding)} />
    </div>
  )
}
