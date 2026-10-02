import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { CheckSquare, Clock, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTaskPerformanceQuery } from '../hooks'

interface TaskProductivityTabProps {
  from?: string
  to?: string
  departmentId?: string
  employeeId?: string
}

export function TaskProductivityTab({
  from,
  to,
  departmentId,
  employeeId,
}: TaskProductivityTabProps) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, refetch } = useTaskPerformanceQuery({
    from,
    to,
    departmentId,
    employeeId,
    page,
    perPage: 15,
  })

  const rows = data?.data || []
  const meta = data?.meta

  // Totals come from the server, which aggregates over the whole filtered
  // result set. Summing `rows` here only covered the current 15-employee page,
  // so the headline completion rate silently changed when paging — a number
  // that looked global but was not.
  const summary = data?.summary
  const totalAssigned = summary?.totalAssigned ?? 0
  const totalCompleted = summary?.totalCompleted ?? 0
  const totalPending = summary?.totalPending ?? 0
  const totalTimeMins = summary?.totalTimeSpentMinutes ?? 0
  const overallCompletionRate = summary?.completionRate ?? 0

  return (
    <div className='space-y-4'>
      {/* KPI Summary Cards */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Assigned
              </span>
              <div className='p-1.5 rounded-lg bg-blue-500/10 text-blue-600'>
                <CheckSquare className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2'>
              <span className='text-2xl font-bold tabular-nums'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : totalAssigned}
              </span>
              <p className='text-[11px] text-muted-foreground mt-0.5'>
                Tasks created in range
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Completed
              </span>
              <div className='p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600'>
                <CheckCircle2 className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2'>
              <span className='text-2xl font-bold tabular-nums text-emerald-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : totalCompleted}
              </span>
              <p className='text-[11px] text-muted-foreground mt-0.5'>
                Marked done in range
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Pending
              </span>
              <div className='p-1.5 rounded-lg bg-amber-500/10 text-amber-600'>
                <AlertCircle className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2'>
              <span className='text-2xl font-bold tabular-nums text-amber-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : totalPending}
              </span>
              <p className='text-[11px] text-muted-foreground mt-0.5'>
                In progress / backlog
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Completion Rate
              </span>
              <div className='p-1.5 rounded-lg bg-purple-500/10 text-purple-600'>
                <CheckSquare className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2'>
              <span className='text-2xl font-bold tabular-nums text-purple-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : `${overallCompletionRate}%`}
              </span>
              {/* Show the counts, not just the label — a bare rate hides both
                  the size of the cohort and the fact that "0 assigned" is
                  indistinguishable from "0 completed" without them. */}
              <p className='text-[11px] text-muted-foreground mt-0.5 tabular-nums'>
                {totalCompleted} / {totalAssigned} completed
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Time Tracked
              </span>
              <div className='p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600'>
                <Clock className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2'>
              <span className='text-2xl font-bold tabular-nums text-cyan-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : formatMins(totalTimeMins)}
              </span>
              <p className='text-[11px] text-muted-foreground mt-0.5'>
                Active timer sessions
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Productivity Table */}
      <Card className='border-border/60'>
        <div className='p-4 border-b flex flex-col gap-1'>
          <h3 className='font-bold text-base'>Employee Task Productivity</h3>
          <p className='text-xs text-muted-foreground'>
            Normalized duration tracking from discrete active/completed work sessions
          </p>
        </div>

        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='bg-muted/30'>
              <TableRow>
                <TableHead className='min-w-[200px]'>Employee</TableHead>
                <TableHead className='text-center'>Assigned</TableHead>
                <TableHead className='text-center'>Completed</TableHead>
                <TableHead className='text-center'>Pending</TableHead>
                <TableHead className='min-w-[160px]'>Completion %</TableHead>
                <TableHead className='text-center'>Time Spent</TableHead>
                <TableHead className='text-right'>Avg Session Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className='h-8 w-40' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-12 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-12 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-12 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-32' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-16 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-16 ml-auto' /></TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-center py-8 text-rose-500'>
                    Failed to load task productivity data.
                    <Button variant='link' onClick={() => refetch()} className='ml-2 text-xs'>
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-center py-10 text-muted-foreground'>
                    No employees found or no task activity in this date range.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.employeeId} className='hover:bg-muted/30'>
                    <TableCell>
                      <div className='flex items-center gap-3'>
                        <Avatar className='h-8 w-8 rounded-lg'>
                          {row.avatar && <AvatarImage src={row.avatar} alt={row.name} />}
                          <AvatarFallback className='rounded-lg text-xs font-bold'>
                            {row.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className='min-w-0'>
                          <p className='text-xs font-semibold truncate'>{row.name}</p>
                          <p className='text-[10px] text-muted-foreground truncate'>
                            {row.employeeCode} {row.department ? `· ${row.department}` : ''}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className='text-center font-semibold text-xs tabular-nums'>
                      {row.assigned}
                    </TableCell>

                    <TableCell className='text-center font-semibold text-xs text-emerald-600 tabular-nums'>
                      {row.completed}
                    </TableCell>

                    <TableCell className='text-center font-semibold text-xs text-amber-600 tabular-nums'>
                      {row.pending}
                    </TableCell>

                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <div className='flex-1 h-2 bg-muted rounded-full overflow-hidden'>
                          <div
                            className='h-full bg-emerald-500 rounded-full transition-all'
                            style={{ width: `${Math.min(100, row.completionRate)}%` }}
                          />
                        </div>
                        {/* An employee with zero assigned tasks has no rate to
                            report. Showing 0% there is indistinguishable from
                            genuinely zero productivity. */}
                        {row.assigned === 0 ? (
                          <span className='text-xs text-muted-foreground tabular-nums w-24 text-right'>
                            —
                          </span>
                        ) : (
                          <span className='text-xs font-semibold tabular-nums w-24 text-right'>
                            {row.completionRate}%
                            <span className='font-normal text-muted-foreground'>
                              {' '}
                              ({row.completed}/{row.assigned})
                            </span>
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className='text-center'>
                      <Badge variant='outline' className='text-xs font-mono font-medium'>
                        {row.timeSpentDisplay}
                      </Badge>
                    </TableCell>

                    <TableCell className='text-right font-mono text-xs tabular-nums text-muted-foreground'>
                      {row.avgTaskDurationDisplay}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between p-4 border-t'>
            <span className='text-xs text-muted-foreground'>
              Showing {rows.length} of {meta.total} employees
            </span>
            <div className='flex items-center gap-1'>
              <Button
                variant='outline'
                size='sm'
                className='h-8 w-8 p-0'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <Button
                variant='outline'
                size='sm'
                className='h-8 w-8 p-0'
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function formatMins(mins: number): string {
  if (!mins) return '0m'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}
