import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addMonths,
  getDay,
  getDaysInMonth,
  startOfMonth,
} from 'date-fns'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface MonthCalendarProps {
  days: number[]
  /** Optional shift ids per weekday, to mark days the employee actually works. */
  shiftDays?: Record<number, string>
}

/**
 * Weekly-off (and optionally shift) preview. Navigable: it used to be pinned to
 * the current month with `new Date()`, so "Month Preview" could only ever
 * preview this month.
 */
export function MonthCalendar({ days, shiftDays }: MonthCalendarProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  const offset = getDay(startOfMonth(month))
  const daysInMonth = getDaysInMonth(month)

  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const today = new Date()
  const isCurrentMonth =
    month.getFullYear() === today.getFullYear() &&
    month.getMonth() === today.getMonth()

  return (
    <div>
      <div className='mb-2 flex items-center justify-between'>
        <p className='text-sm font-medium text-muted-foreground'>
          {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </p>
        <div className='flex items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            aria-label='Previous month'
            onClick={() => setMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          {!isCurrentMonth && (
            <Button
              variant='ghost'
              size='sm'
              className='h-7'
              onClick={() => setMonth(startOfMonth(new Date()))}
            >
              Today
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            aria-label='Next month'
            onClick={() => setMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      </div>
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
          const shiftName = shiftDays?.[weekday]
          const isToday =
            day === today.getDate() &&
            today.getMonth() === month.getMonth() &&
            today.getFullYear() === month.getFullYear()
          return (
            <div
              key={day}
              title={
                isOff
                  ? `Weekly off${shiftName ? ' — no shift' : ''}`
                  : shiftName
                    ? `Shift: ${shiftName}`
                    : undefined
              }
              className={cn(
                'flex h-9 items-center justify-center rounded-md text-sm',
                isOff
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                  : shiftName
                    ? 'bg-[var(--color-info-soft)] text-[var(--color-info-ink)]'
                    : 'text-muted-foreground',
                isToday && 'ring-1 ring-inset ring-ring'
              )}
            >
              {day}
            </div>
          )
        })}
      </div>
      <div className='mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
        <span className='inline-flex items-center gap-1.5'>
          <span className='size-3 rounded-sm bg-amber-100 dark:bg-amber-900/40' />
          Weekly off
        </span>
        {shiftDays && Object.keys(shiftDays).length > 0 && (
          <span className='inline-flex items-center gap-1.5'>
            <span className='size-3 rounded-sm bg-[var(--color-info-soft)]' />
            Shift
          </span>
        )}
      </div>
    </div>
  )
}