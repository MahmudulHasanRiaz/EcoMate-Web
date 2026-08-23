import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDailyOverviewQuery } from '../hooks'
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
} from '../api'

const STATUS_COUNT_BADGE: Record<string, string> = {
  PRESENT: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  ABSENT: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  LATE: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  HALF_DAY: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
  ON_LEAVE: 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300',
  WEEKLY_OFF: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300',
}

export function DailyOverview({ date }: { date: Date }) {
  const dateKey = date ? date.toISOString().slice(0, 10) : undefined
  const { data, isLoading, isError, refetch } = useDailyOverviewQuery(dateKey!)

  const counts = data?.counts ?? null

  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7'>
      {isLoading || !counts ? (
        Array.from({ length: 7 }).map((_, i) => (
          <Card key={i}>
            <CardContent className='p-3'>
              <Skeleton className='h-3 w-16 mb-2' />
              <Skeleton className='h-6 w-8' />
            </CardContent>
          </Card>
        ))
      ) : isError ? (
        <Card className='col-span-full'>
          <CardContent className='flex flex-col items-center gap-3 py-8 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load daily overview.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className='p-3'>
              <p className='text-xs font-medium text-muted-foreground'>Total Records</p>
              <p className='mt-0.5 text-2xl font-bold tabular-nums'>{data.total}</p>
            </CardContent>
          </Card>
          {ATTENDANCE_STATUSES.map((s) => (
            <Card key={s}>
              <CardContent className={`p-3 ${STATUS_COUNT_BADGE[s]}`}>
                <p className='text-xs font-medium opacity-80'>{ATTENDANCE_STATUS_LABELS[s]}</p>
                <p className='mt-0.5 text-2xl font-bold tabular-nums'>{counts[s] ?? 0}</p>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}