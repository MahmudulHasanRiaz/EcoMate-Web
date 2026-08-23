import { getDay, getDaysInMonth, startOfMonth } from 'date-fns'
import { cn } from '@/lib/utils'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface MonthCalendarProps {
  days: number[]
}

export function MonthCalendar({ days }: MonthCalendarProps) {
  const now = new Date()
  const offset = getDay(startOfMonth(now))
  const daysInMonth = getDaysInMonth(now)

  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div>
      <p className='text-sm font-medium text-muted-foreground mb-2'>
        {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </p>
      <div className='grid grid-cols-7 gap-1 text-center text-xs'>
        {WEEKDAY_HEADERS.map((w) => (
          <div key={w} className='py-1 font-medium text-muted-foreground'>
            {w}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day == null) return <div key={`empty-${idx}`} />
          const weekday = (offset + (day - 1)) % 7
          const isOff = days.includes(weekday)
          const isToday = day === now.getDate()
          return (
            <div
              key={day}
              className={cn(
                'flex h-9 items-center justify-center rounded-md text-sm',
                isOff
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'text-muted-foreground',
                isToday && 'ring-1 ring-inset ring-ring'
              )}
            >
              {day}
            </div>
          )
        })}
      </div>
      <p className='mt-3 text-xs text-muted-foreground'>
        Amber days are weekly off.
      </p>
    </div>
  )
}