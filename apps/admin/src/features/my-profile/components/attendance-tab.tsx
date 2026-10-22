import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Clock,
  Play,
  Pause,
  Square,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Loader2,
  Timer,
  Coffee,
  LogIn,
  LogOut,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDhakaDate } from '@/lib/dhaka-time'
import {
  useMyAttendanceTodayQuery,
  useMyAttendanceHistoryQuery,
  useMyCheckInMutation,
  useMyBreakStartMutation,
  useMyBreakEndMutation,
  useMyCheckOutMutation,
} from '../hooks'
import type { AttendanceStatus } from '../api'

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; className: string }> = {
  PRESENT: { label: 'Present', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  LATE: { label: 'Late', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
  HALF_DAY: { label: 'Half Day', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20' },
  ABSENT: { label: 'Absent', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  ON_LEAVE: { label: 'On Leave', className: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20' },
  WEEKLY_OFF: { label: 'Weekly Off', className: 'bg-muted text-muted-foreground border-border' },
}

function formatMinutes(min?: number | null) {
  if (min == null || min <= 0) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatTime(isoStr?: string | null) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
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

export function AttendanceTab() {
  const { data: todayState, isLoading: todayLoading } = useMyAttendanceTodayQuery()
  const { data: history = [], isLoading: historyLoading } = useMyAttendanceHistoryQuery()
  const clock = useDhakaClock()

  const checkInMut = useMyCheckInMutation()
  const breakStartMut = useMyBreakStartMutation()
  const breakEndMut = useMyBreakEndMutation()
  const checkOutMut = useMyCheckOutMutation()

  const isClockMutating =
    checkInMut.isPending || breakStartMut.isPending || breakEndMut.isPending || checkOutMut.isPending

  // Month overview calculations
  const stats = {
    present: history.filter((h) => h.status === 'PRESENT').length,
    late: history.filter((h) => h.status === 'LATE').length,
    halfDay: history.filter((h) => h.status === 'HALF_DAY').length,
    absent: history.filter((h) => h.status === 'ABSENT').length,
    totalMinutes: history.reduce((sum, h) => sum + (h.workedMinutes || 0), 0),
  }

  const state = todayState?.state || 'not_checked_in'
  const appAllowed = todayState?.appAllowed !== false
  const shiftMinutes = 480
  const workedMinutes = todayState?.workedMinutes ?? 0
  const progressPct = Math.min(100, Math.round((workedMinutes / shiftMinutes) * 100))

  return (
    <div className="space-y-6">
      {/* Today Live State & Clock */}
      <Card className="border-border/60 bg-card overflow-hidden shadow-xs">
        <CardHeader
          className={cn(
            'border-b transition-colors pb-4',
            state === 'working'
              ? 'bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20'
              : state === 'on_break'
              ? 'bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/20'
              : state === 'checked_out'
              ? 'bg-gradient-to-br from-sky-500/10 via-sky-500/5 to-transparent border-sky-500/20'
              : 'bg-muted/20 border-border/50'
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Today's Live Attendance
              </CardTitle>
              <CardDescription>
                Real-time check-in status and session tracker for the Dhaka business day.
              </CardDescription>
            </div>

            {/* Live State Badge & Clock */}
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background/80 border border-border/60 text-xs font-semibold tabular-nums text-foreground/85 shadow-2xs">
                <Clock className="size-3 text-muted-foreground" />
                <span>{clock}</span>
                <span className="text-[10px] text-muted-foreground font-mono">BST</span>
              </div>

              {todayLoading ? (
                <Skeleton className="h-7 w-28 rounded-full" />
              ) : state === 'working' ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1.5 px-3 py-1 shadow-2xs">
                  <span className="relative flex size-2 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Currently Working
                </Badge>
              ) : state === 'on_break' ? (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1.5 px-3 py-1 shadow-2xs">
                  <span className="relative flex size-2 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
                  </span>
                  On Break
                </Badge>
              ) : state === 'checked_out' ? (
                <Badge variant="outline" className="bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 gap-1.5 px-3 py-1 shadow-2xs">
                  <span className="size-1.5 rounded-full bg-sky-500" />
                  Checked Out
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-muted/60 text-muted-foreground border-border/60 gap-1.5 px-3 py-1 shadow-2xs">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  Not Checked In Today
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5 space-y-4">
          {/* Shift Progress Bar */}
          {state !== 'not_checked_in' && (
            <div className="space-y-1.5 p-3 rounded-xl border border-border/50 bg-muted/20">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-3.5 text-amber-500" />
                  Standard Shift Target (8 Hours)
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {progressPct}% ({formatMinutes(workedMinutes)} logged)
                </span>
              </div>
              <div className="h-2 w-full bg-muted/80 rounded-full overflow-hidden">
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

          {/* 4-Stat Metric Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/40 transition-colors flex items-center gap-3">
              <div className="size-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <LogIn className="size-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block truncate">
                  Check-in Time
                </span>
                <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                  {todayState?.checkInAt ? formatTime(todayState.checkInAt) : '—'}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/40 transition-colors flex items-center gap-3">
              <div className="size-9 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <LogOut className="size-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block truncate">
                  Check-out Time
                </span>
                <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                  {todayState?.checkOutAt ? formatTime(todayState.checkOutAt) : '—'}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/40 transition-colors flex items-center gap-3">
              <div className="size-9 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                <Timer className="size-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block truncate">
                  Worked Time
                </span>
                <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                  {formatMinutes(todayState?.workedMinutes)}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/30 hover:bg-muted/40 transition-colors flex items-center gap-3">
              <div className="size-9 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Coffee className="size-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block truncate">
                  Break Time
                </span>
                <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                  {formatMinutes(todayState?.breakMinutes)}
                </p>
              </div>
            </div>
          </div>

          {/* Clock Actions */}
          {appAllowed ? (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {state === 'not_checked_in' && (
                <Button
                  onClick={() => checkInMut.mutate(undefined)}
                  disabled={isClockMutating}
                  className="bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-medium gap-2 shadow-xs h-10 px-5 transition-all"
                >
                  {checkInMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Check In Now
                </Button>
              )}

              {state === 'working' && (
                <>
                  <Button
                    onClick={() => breakStartMut.mutate()}
                    disabled={isClockMutating}
                    variant="outline"
                    className="gap-2 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 font-medium h-10 px-4 transition-all"
                  >
                    {breakStartMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                    Start Break
                  </Button>
                  <Button
                    onClick={() => checkOutMut.mutate(undefined)}
                    disabled={isClockMutating}
                    variant="destructive"
                    className="gap-2 shadow-xs font-medium h-10 px-4 transition-all"
                  >
                    {checkOutMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                    Check Out
                  </Button>
                </>
              )}

              {state === 'on_break' && (
                <Button
                  onClick={() => breakEndMut.mutate()}
                  disabled={isClockMutating}
                  className="bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white font-medium gap-2 shadow-xs h-10 px-5 transition-all"
                >
                  {breakEndMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Resume Work (End Break)
                </Button>
              )}

              {state === 'checked_out' && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-foreground flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>You have completed your work session for today.</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {todayState?.appBlockedReason || 'Attendance is tracked via biometric device.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Month Summary Chips */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="border-border/60">
          <CardContent className="p-3.5">
            <span className="text-xs text-muted-foreground">Present Days</span>
            <p className="mt-1 text-xl font-bold text-emerald-600">{stats.present}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3.5">
            <span className="text-xs text-muted-foreground">Late Arrivals</span>
            <p className="mt-1 text-xl font-bold text-amber-600">{stats.late}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3.5">
            <span className="text-xs text-muted-foreground">Half Days</span>
            <p className="mt-1 text-xl font-bold text-blue-600">{stats.halfDay}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3.5">
            <span className="text-xs text-muted-foreground">Absences</span>
            <p className="mt-1 text-xl font-bold text-destructive">{stats.absent}</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3.5">
            <span className="text-xs text-muted-foreground">Total Hours Worked</span>
            <p className="mt-1 text-xl font-bold text-foreground">
              {Math.round((stats.totalMinutes / 60) * 10) / 10}h
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Attendance History Table */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Attendance History Log
          </CardTitle>
          <CardDescription>
            Daily work records, check-in timestamps, and duration breakdown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No attendance records recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>First Check-in</TableHead>
                    <TableHead>Last Check-out</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                    <TableHead className="text-right">Break</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((row) => {
                    const badge = STATUS_CONFIG[row.status] || {
                      label: row.status,
                      className: 'bg-muted text-muted-foreground',
                    }
                    const firstSession = row.sessions?.[0]
                    const lastSession = row.sessions?.[row.sessions.length - 1]

                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-xs whitespace-nowrap">
                          {formatDhakaDate(row.date)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${badge.className}`}>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {firstSession?.checkInAt ? formatTime(firstSession.checkInAt) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {lastSession?.checkOutAt ? formatTime(lastSession.checkOutAt) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium text-xs tabular-nums">
                          {formatMinutes(row.workedMinutes)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {formatMinutes(row.breakMinutes)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                          {row.note || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
