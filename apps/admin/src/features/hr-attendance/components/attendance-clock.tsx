import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Coffee,
  Loader2,
  LogIn,
  LogOut,
  Sparkles,
  Timer,
} from 'lucide-react'
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
 * State styling with WCAG AA accessible contrast for light and dark themes.
 */
const STATE_TONE: Record<DayStateValue, string> = {
  none: 'bg-muted/80 text-muted-foreground border-border/50',
  before_work: 'bg-muted/80 text-muted-foreground border-border/50',
  working:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  on_break:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  checked_out:
    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
}

const STATE_DOT: Record<DayStateValue, string> = {
  none: 'bg-muted-foreground/50',
  before_work: 'bg-muted-foreground/50',
  working: 'bg-emerald-500',
  on_break: 'bg-amber-500',
  checked_out: 'bg-sky-500',
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
  breakStart: { label: 'Start Break', icon: Coffee, variant: 'outline' },
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
  const shiftMinutes = 480 // 8 hours standard full-time shift
  const workedMinutes = day?.workedMinutes ?? 0
  const progressPct = Math.min(100, Math.round((workedMinutes / shiftMinutes) * 100))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          aria-label='Attendance clock'
          className={cn(
            'group inline-flex h-8 shrink-0 items-center gap-1.5 sm:gap-2 rounded-md px-2 text-xs',
            'border border-transparent transition-all duration-150',
            'hover:bg-accent/80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          )}
        >
          <div className='flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted-foreground group-hover:text-foreground transition-colors'>
            <Clock className='size-3 shrink-0 text-muted-foreground/70' />
            <span>{clock}</span>
          </div>

          <span className='h-3 w-px bg-border/60' />

          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold border transition-colors shadow-2xs',
              STATE_TONE[state]
            )}
          >
            {state === 'working' ? (
              <span className='relative flex size-2 items-center justify-center'>
                <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                <span className='relative inline-flex size-1.5 rounded-full bg-emerald-500' />
              </span>
            ) : state === 'on_break' ? (
              <span className='relative flex size-2 items-center justify-center'>
                <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75' />
                <span className='relative inline-flex size-1.5 rounded-full bg-amber-500' />
              </span>
            ) : (
              <span className={cn('size-1.5 rounded-full', STATE_DOT[state])} />
            )}
            {STATE_LABEL[state]}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align='end'
        sideOffset={6}
        className='w-80 sm:w-[360px] p-0 overflow-hidden rounded-2xl border border-border/80 shadow-2xl backdrop-blur-xl bg-popover/95'
      >
        {/* Dynamic State Header */}
        <div
          className={cn(
            'px-4 pt-4 pb-3.5 border-b transition-colors',
            state === 'working'
              ? 'bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/20'
              : state === 'on_break'
              ? 'bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent border-amber-500/20'
              : state === 'checked_out'
              ? 'bg-gradient-to-br from-sky-500/15 via-sky-500/5 to-transparent border-sky-500/20'
              : 'bg-gradient-to-br from-primary/10 via-muted/30 to-transparent border-border/60'
          )}
        >
          <div className='flex items-center justify-between gap-2 mb-2'>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shadow-2xs',
                STATE_TONE[state]
              )}
            >
              {state === 'working' ? (
                <span className='relative flex size-2 items-center justify-center'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                  <span className='relative inline-flex size-1.5 rounded-full bg-emerald-500' />
                </span>
              ) : state === 'on_break' ? (
                <span className='relative flex size-2 items-center justify-center'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75' />
                  <span className='relative inline-flex size-1.5 rounded-full bg-amber-500' />
                </span>
              ) : (
                <span className={cn('size-1.5 rounded-full', STATE_DOT[state])} />
              )}
              {STATE_LABEL[state]}
            </span>

            <div className='flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-background/80 border border-border/60 text-[11px] font-medium tabular-nums text-foreground/80 shadow-2xs'>
              <Clock className='size-3 text-muted-foreground' />
              <span>{clock}</span>
              <span className='text-[10px] text-muted-foreground font-mono'>BST</span>
            </div>
          </div>

          <div>
            <p className='text-sm font-semibold text-foreground flex items-center gap-1.5'>
              {state === 'checked_out' ? 'Checked Out' : STATE_LABEL[state]}
              {day?.checkInAt && state !== 'checked_out' && (
                <span className='font-normal text-muted-foreground text-xs'>
                  since {formatTime(day.checkInAt)}
                </span>
              )}
            </p>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              Worked {formatDuration(day?.workedMinutes ?? 0)} · Break{' '}
              {formatDuration(day?.breakMinutes ?? 0)}
            </p>
          </div>
        </div>

        {/* Popover Body */}
        <div className='p-4 space-y-3.5'>
          {/* Metrics Grid */}
          <div className='grid grid-cols-2 gap-2.5'>
            <div className='p-2.5 rounded-xl border border-border/60 bg-muted/30 flex items-center gap-2.5'>
              <div className='size-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0'>
                <Timer className='size-4' />
              </div>
              <div className='min-w-0'>
                <span className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground block'>
                  Worked
                </span>
                <p className='text-sm font-bold tabular-nums text-foreground truncate'>
                  {formatDuration(day?.workedMinutes ?? 0)}
                </p>
              </div>
            </div>

            <div className='p-2.5 rounded-xl border border-border/60 bg-muted/30 flex items-center gap-2.5'>
              <div className='size-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0'>
                <Coffee className='size-4' />
              </div>
              <div className='min-w-0'>
                <span className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground block'>
                  Break
                </span>
                <p className='text-sm font-bold tabular-nums text-foreground truncate'>
                  {formatDuration(day?.breakMinutes ?? 0)}
                </p>
              </div>
            </div>
          </div>

          {/* Shift Progress Bar */}
          {state !== 'none' && state !== 'before_work' && (
            <div className='space-y-1.5 pt-0.5'>
              <div className='flex items-center justify-between text-[11px] text-muted-foreground'>
                <span className='flex items-center gap-1 font-medium'>
                  <Sparkles className='size-3 text-amber-500' />
                  Shift Progress (8h)
                </span>
                <span className='font-semibold tabular-nums text-foreground'>
                  {progressPct}%
                </span>
              </div>
              <div className='h-1.5 w-full bg-muted/80 rounded-full overflow-hidden'>
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    state === 'working' || state === 'checked_out'
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      : 'bg-gradient-to-r from-amber-500 to-amber-400'
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {actions.length > 0 ? (
            <div className='flex flex-wrap gap-2 pt-1'>
              {actions.map((action) => {
                const { label, icon: Icon, variant } = ACTION_META[action]
                const isCheckIn = action === 'checkIn'
                const isBreakStart = action === 'breakStart'
                const isBreakEnd = action === 'breakEnd'
                const isCheckOut = action === 'checkOut'

                return (
                  <Button
                    key={action}
                    size='sm'
                    variant={variant}
                    disabled={busy}
                    onClick={() => mutate.mutate(action)}
                    className={cn(
                      'transition-all duration-150 font-medium active:scale-[0.98]',
                      isCheckIn &&
                        'w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs text-sm',
                      isBreakEnd &&
                        'w-full h-10 bg-amber-600 hover:bg-amber-700 text-white shadow-xs text-sm',
                      isBreakStart &&
                        'flex-1 h-9 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10',
                      isCheckOut &&
                        'flex-1 h-9 border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10'
                    )}
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
            <div className='rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground flex items-center gap-2.5'>
              <CheckCircle2 className='size-4 text-emerald-600 dark:text-emerald-400 shrink-0' />
              <span>Your attendance for today is complete.</span>
            </div>
          )}

          {/* Footer Quick Links */}
          <div className='pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground'>
            <span className='flex items-center gap-1.5'>
              <span className='size-1.5 rounded-full bg-emerald-500' />
              Asia/Dhaka
            </span>
            <Link
              to='/op/my-profile'
              className='inline-flex items-center gap-1 font-medium text-primary hover:underline hover:text-primary/80 transition-colors'
            >
              <span>My Attendance & Leaves</span>
              <ArrowUpRight className='size-3' />
            </Link>
          </div>
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