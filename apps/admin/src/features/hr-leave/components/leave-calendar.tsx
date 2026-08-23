import { useMemo } from 'react'
import { getDay, getDaysInMonth, startOfMonth } from 'date-fns'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { useCalendarQuery } from '../hooks'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toDateOnly(d: string) {
  return new Date(new Date(d).toDateString())
}

export function LeaveCalendar({
  employeeId,
  year,
  month,
}: {
  employeeId?: string
  year: number
  month: number
}) {
  const { data, isLoading } = useCalendarQuery({ employeeId, year, month })

  const leaves = Array.isArray(data) ? data : []

  const ranges = useMemo(
    () =>
      leaves
        .map((l) => ({
          start: toDateOnly(l.startDate),
          end: toDateOnly(l.endDate),
          typeName: l.typeName,
        }))
        .filter((r) => r.start <= r.end),
    [leaves],
  )

  if (!employeeId) {
    return (
      <div className='py-6 text-center text-sm text-muted-foreground'>
        Select an employee to view the leave calendar.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex justify-center py-6'>
        <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
      </div>
    )
  }

  const offset = getDay(startOfMonth(new Date(year, month - 1)))
  const daysInMonth = getDaysInMonth(new Date(year, month - 1))
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function labelsFor(day: number) {
    const date = toDateOnly(new Date(year, month - 1, day).toDateString())
    return ranges
      .filter((r) => date >= r.start && date <= r.end)
      .map((r) => r.typeName)
  }

  return (
    <div>
      <p className='text-sm font-medium text-muted-foreground mb-2'>
        {new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </p>
      <div className='grid grid-cols-7 gap-1 text-center text-xs'>
        {WEEKDAY_HEADERS.map((w) => (
          <div key={w} className='py-1 font-medium text-muted-foreground'>{w}</div>
        ))}
        {cells.map((day, idx) => {
          if (day == null) return <div key={`empty-${idx}`} />
          const labels = labelsFor(day)
          const hasLeave = labels.length > 0
          return (
            <div
              key={day}
              title={hasLeave ? labels.join(', ') : undefined}
              className={cn(
                'flex h-9 items-center justify-center rounded-md text-sm',
                hasLeave
                  ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
                  : 'text-muted-foreground',
              )}
            >
              {day}
            </div>
          )
        })}
      </div>
      <p className='mt-3 text-xs text-muted-foreground'>Green days are approved leaves (hover for type).</p>
    </div>
  )
}
