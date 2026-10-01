import { useEffect, useState } from 'react'
import { Coffee, Loader2, LogIn, LogOut } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  formatDuration,
  formatTime,
  type DayStateValue,
  type MyDayState,
} from '../api'
import {
  useMyAttendanceActionMutation,
  useMyAttendanceTodayQuery,
  useMyHrProfileQuery,
  type MyAttendanceAction,
} from '../hooks'

/**
 * State styling.
 *
 * The `--*-soft` tokens are only ~12% alpha, which drops the chip's text
 * contrast below WCAG AA at this size (measured 4.31:1 for "Working" in light
 * mode). These tones layer a solid colour-matched background UNDER the soft
 * tint instead: the tint still supplies the hue, but the effective background
 * is opaque enough for the ink to stay legible in both themes.
 */
const STATE_TONE: Record<DayStateValue, string> = {
  none: 'bg-[var(--surface-raised)] text-muted-foreground',
  before_work: 'bg-[var(--surface-raised)] text-muted-foreground',
  working:
    'bg-[linear-gradient(var(--color-success-soft),var(--color-success-soft)),var(--surface-raised)] text-[var(--color-success-ink)]',
  on_break:
    'bg-[linear-gradient(var(--color-warning-soft),var(--color-warning-soft)),var(--surface-raised)] text-[var(--color-warning-ink)]',
  checked_out:
    'bg-[linear-gradient(var(--color-info-soft),var(--color-info-soft)),var(--surface-raised)] text-[var(--color-info-ink)]',
}

const STATE_DOT: Record<DayStateValue, string> = {
  none: 'bg-muted-foreground/50',
  before_work: 'bg-muted-foreground/50',
  working: 'bg-[var(--color-success)]',
  on_break: 'bg-[var(--color-warning)]',
  checked_out: 'bg-[var(--color-info)]',
}

const STATE_LABEL: Record<DayStateValue, string> = {
  none: 'Not In',
  before_work: 'Not In',
  working: 'Working',
  on_break: 'On Break',
  checked_out: 'Checked Out',
}

/**
 * The button set is derived purely from the day state, mirroring the storefront
 * HR section so both surfaces behave identically.
 */
function actionsFor(state: DayStateValue): MyAttendanceAction[] {
  switch (state) {
    case 'working':
      return ['breakStart', 'checkOut']
    case 'on_break':
      return ['breakEnd']
    case 'checked_out':
      return []
    case 'none':
    case 'before_work':
    default:
      return ['checkIn']
  }
}

const ACTION_META: Record<
  MyAttendanceAction,
  { label: string; icon: typeof LogIn; variant: 'default' | 'outline' }
> = {
  checkIn: { label: 'Check In', icon: LogIn, variant: 'default' },
  breakStart: { label: 'Start Break', icon: Coffee, variant: 'default' },
  breakEnd: { label: 'End Break', icon: Coffee, variant: 'default' },
  checkOut: { label: 'Check Out', icon: LogOut, variant: 'outline' },
}

function useDhakaClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

function useHeaderSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    // The <Header> that owns the placeholder mounts with the current route, so
    // the lookup has to re-run after every navigation — not just on mount.
    const id = setInterval(() => {
      setSlot((prev) => {
        if (prev?.isConnected) return prev
        return document.querySelector<HTMLElement>('[data-attendance-clock-slot]')
      })
    }, 250)
    return () => clearInterval(id)
  }, [])
  return slot
}

function ClockBody() {
  const accessToken = useAuthStore((s) => s.auth.accessToken)

  // Gate on the employee link alone, NOT on `permissions`: a staff member with
  // no access preset legitimately has an empty permission list, yet is exactly
  // who this widget exists for. The /hr/my endpoints are role-guarded
  // server-side, and a 404 from the profile probe means "not an employee".
  const signedIn = !!accessToken
  const profile = useMyHrProfileQuery(signedIn)
  const isEmployee = profile.data !== null && profile.isSuccess

  const today = useMyAttendanceTodayQuery(isEmployee)
  const mutate = useMyAttendanceActionMutation()
  const clock = useDhakaClock()

  const day: MyDayState | undefined = today.data
  const state: DayStateValue = day?.state ?? 'none'

  if (!signedIn || !isEmployee) return null
  // System mode (MACHINE) or the employee's own method blocks app attendance —
  // hide the control entirely rather than offering a button that cannot work.
  if (day && day.appAllowed === false) return null

  const actions = actionsFor(state)
  const busy = mutate.isPending

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label='Attendance clock'
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm',
            'border border-transparent transition-colors duration-150',
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          )}
        >
          <span className='text-[11px] font-medium tabular-nums text-muted-foreground'>
            {clock}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold',
              STATE_TONE[state]
            )}
          >
            <span className={cn('size-1.5 rounded-full', STATE_DOT[state])} />
            {STATE_LABEL[state]}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align='end' sideOffset={6} className='w-72'>
        <div className='grid gap-3'>
          <div>
            <p className='text-sm font-semibold'>
              {state === 'checked_out' ? 'Checked Out' : STATE_LABEL[state]}
              {day?.checkInAt && state !== 'checked_out' && (
                <span className='ml-1.5 font-normal text-muted-foreground'>
                  since {formatTime(day.checkInAt)}
                </span>
              )}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              Worked {formatDuration(day?.workedMinutes ?? 0)} · Break{' '}
              {formatDuration(day?.breakMinutes ?? 0)}
            </p>
          </div>

          {actions.length > 0 ? (
            <div className='flex flex-wrap gap-2'>
              {actions.map((action) => {
                const { label, icon: Icon, variant } = ACTION_META[action]
                return (
                  <Button
                    key={action}
                    size='sm'
                    variant={variant}
                    disabled={busy}
                    onClick={() => mutate.mutate(action)}
                  >
                    {busy && mutate.variables === action ? (
                      <Loader2 className='h-4 w-4 animate-spin mr-1.5' />
                    ) : (
                      <Icon className='h-4 w-4 mr-1.5' />
                    )}
                    {label}
                  </Button>
                )
              })}
            </div>
          ) : (
            <p className='text-xs text-muted-foreground'>
              Your attendance for today is complete.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Global attendance clock. Mounted once in the app shell, then portalled into
 * every page's <Header> via a placeholder the header renders itself — that
 * keeps the widget in the bar's flex row (so it sits beside the theme switch
 * and profile menu instead of floating over them) without every page having to
 * render it by hand.
 *
 * Renders nothing unless the account is an employee whose app attendance is
 * currently permitted — no dead buttons, and no wasted header space.
 */
export function AttendanceClock() {
  const slot = useHeaderSlot()
  if (!slot) return null
  return createPortal(<ClockBody />, slot)
}