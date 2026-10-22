import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckSquare, Clock, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { formatDhakaDate } from '@/lib/dhaka-time'

interface EmployeeTasksTabProps {
  employeeId: string
}

export function EmployeeTasksTab({ employeeId }: EmployeeTasksTabProps) {
  const [page, setPage] = useState(1)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['employee-tasks', employeeId, page],
    queryFn: () =>
      apiClient
        .get<{
          data: any[]
          meta: { total: number; page: number; perPage: number; totalPages: number }
        }>(`/tasks/employee/${employeeId}`, { params: { page, perPage: 10 } })
        .then((res) => res.data),
    enabled: !!employeeId,
  })

  const tasks = data?.data || []
  const meta = data?.meta

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const pendingCount = tasks.length - doneCount

  return (
    <div className='space-y-4'>
      {/* KPI Cards */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
              Assigned Tasks
            </span>
            <p className='mt-1 text-2xl font-bold tabular-nums'>{meta?.total ?? tasks.length}</p>
          </CardContent>
        </Card>
        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
              Completed
            </span>
            <p className='mt-1 text-2xl font-bold tabular-nums text-emerald-600'>{doneCount}</p>
          </CardContent>
        </Card>
        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
              In Progress / Pending
            </span>
            <p className='mt-1 text-2xl font-bold tabular-nums text-amber-600'>{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
              Tracked Time
            </span>
            <p className='mt-1 text-2xl font-bold tabular-nums text-purple-600'>
              {Math.ceil(tasks.reduce((s, t) => s + (t.actualMinutes || 0), 0) / 60)}h
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tasks Table */}
      <Card className='border-border/60'>
        <CardHeader className='p-4 border-b'>
          <div className='flex items-center gap-2'>
            <CheckSquare className='h-4 w-4 text-primary' />
            <div>
              <CardTitle className='text-base'>Assigned Tasks</CardTitle>
              <CardDescription className='text-xs'>
                Tasks specifically assigned to this staff member with tracked durations
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='bg-muted/30'>
              <TableRow>
                <TableHead className='w-[130px]'>Task ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className='text-center'>Status</TableHead>
                <TableHead className='text-center'>Priority</TableHead>
                <TableHead className='text-center'>Est. Time</TableHead>
                <TableHead className='text-center'>Actual Time</TableHead>
                <TableHead className='text-right'>Due Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className='h-4 w-20' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-40' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-16 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-16 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-12 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-12 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-4 w-20 ml-auto' /></TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-center py-8 text-rose-500'>
                    Failed to load tasks.
                    <Button variant='link' size='sm' onClick={() => refetch()} className='ml-2 text-xs'>
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ) : tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-center py-10 text-muted-foreground'>
                    No tasks assigned to this employee.
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task: any) => (
                  <TableRow key={task.id} className='hover:bg-muted/30'>
                    <TableCell className='font-mono font-semibold text-xs'>
                      {task.displayId}
                    </TableCell>
                    <TableCell>
                      <p className='text-xs font-medium'>{task.title}</p>
                      {task.description && (
                        <p className='text-[10px] text-muted-foreground line-clamp-1'>
                          {task.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className='text-center'>
                      <Badge variant='outline' className='text-[10px] uppercase font-bold'>
                        {task.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-center'>
                      <Badge
                        variant='outline'
                        className={`text-[10px] uppercase font-medium ${
                          task.priority === 'high' || task.priority === 'urgent'
                            ? 'text-rose-600 border-rose-300'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {task.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-center text-xs tabular-nums text-muted-foreground'>
                      {task.estimatedMinutes ? `${task.estimatedMinutes}m` : '—'}
                    </TableCell>
                    <TableCell className='text-center'>
                      <span className='text-xs font-semibold tabular-nums text-purple-600'>
                        {task.actualMinutes ? `${task.actualMinutes}m` : '0m'}
                      </span>
                    </TableCell>
                    <TableCell className='text-right text-xs text-muted-foreground'>
                      {task.dueDate ? formatDhakaDate(task.dueDate) : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between p-4 border-t'>
            <span className='text-xs text-muted-foreground'>
              Page {meta.page} of {meta.totalPages}
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
