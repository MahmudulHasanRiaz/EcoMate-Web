import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Clock, Play, Pause, Square, CheckCircle2, AlertTriangle, Calendar, Loader2 } from 'lucide-react'
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

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(isoStr?: string | null) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AttendanceTab() {
  const { data: todayState, isLoading: todayLoading } = useMyAttendanceTodayQuery()
  const { data: history = [], isLoading: historyLoading } = useMyAttendanceHistoryQuery()

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

  return (
    <div className="space-y-6">
      {/* Today Live State & Clock */}
      <Card className="border-border/60 bg-card overflow-hidden">
        <CardHeader className="border-b border-border/50 bg-muted/20 pb-4">
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

            {/* Live State Badge */}
            <div>
              {todayLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : state === 'working' ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1.5 px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Currently Working
                </Badge>
              ) : state === 'on_break' ? (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 gap-1.5 px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  On Break
                </Badge>
              ) : state === 'checked_out' ? (
                <Badge variant="outline" className="bg-muted text-muted-foreground gap-1.5 px-3 py-1">
                  Checked Out
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground gap-1.5 px-3 py-1">
                  Not Checked In Today
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="p-3.5 rounded-lg border bg-muted/30">
              <span className="text-xs text-muted-foreground">Check-in Time</span>
              <p className="mt-1 text-base font-semibold">
                {todayState?.checkInAt ? formatTime(todayState.checkInAt) : '—'}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border bg-muted/30">
              <span className="text-xs text-muted-foreground">Check-out Time</span>
              <p className="mt-1 text-base font-semibold">
                {todayState?.checkOutAt ? formatTime(todayState.checkOutAt) : '—'}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border bg-muted/30">
              <span className="text-xs text-muted-foreground">Worked Time</span>
              <p className="mt-1 text-base font-semibold">
                {formatMinutes(todayState?.workedMinutes)}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border bg-muted/30">
              <span className="text-xs text-muted-foreground">Break Time</span>
              <p className="mt-1 text-base font-semibold">
                {formatMinutes(todayState?.breakMinutes)}
              </p>
            </div>
          </div>

          {/* Clock Actions */}
          {appAllowed ? (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {state === 'not_checked_in' && (
                <Button
                  onClick={() => checkInMut.mutate(undefined)}
                  disabled={isClockMutating}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-xs"
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
                    className="gap-2 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
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
                    className="gap-2 shadow-xs"
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
                  className="bg-primary text-primary-foreground gap-2 shadow-xs"
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
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  You have completed your work session for today.
                </p>
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
                          {formatDate(row.date)}
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
