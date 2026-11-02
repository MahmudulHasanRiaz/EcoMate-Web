import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { getCourierColor } from './data/data'
import { useDispatchMetrics } from './hooks'

/**
 * Compact overview strip (owner rework, 2026-11-02): one slim row of
 * figures that follows the SAME filters as the list — pick a courier or
 * a status and every number re-scopes to that selection. Replaces the
 * old grid of tall global-only cards that sat above the filters it
 * ignored.
 */
export function DispatchMetrics({
  params,
  filtered,
}: {
  params?: any
  filtered?: boolean
}) {
  const { data, isLoading } = useDispatchMetrics(params)

  if (isLoading) {
    return (
      <div className='flex flex-wrap items-center gap-2'>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className='h-8 w-28 rounded-md' />
        ))}
      </div>
    )
  }

  if (!data) return null

  const courierCounts = data.byCourier ?? []
  const statusCounts = (data.byStatus ?? []).filter((s) => s.count > 0)

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <span className='inline-flex h-8 items-center gap-2 rounded-md border bg-card px-3 text-sm'>
        <span className='text-muted-foreground'>Total</span>
        <span className='font-bold tabular-nums'>{data.total}</span>
        {filtered ? (
          <span className='rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'>
            Filtered
          </span>
        ) : null}
      </span>
      {courierCounts.map(({ courier, count }) => (
        <span
          key={courier}
          className='inline-flex h-8 items-center gap-2 rounded-md border bg-card px-3 text-sm'
        >
          <span
            className='h-2 w-2 rounded-full'
            style={{ backgroundColor: getCourierColor(courier) || '#6b7280' }}
          />
          <span className='capitalize text-muted-foreground'>{courier}</span>
          <span className='font-semibold tabular-nums'>{count}</span>
        </span>
      ))}
      {statusCounts.length > 0 && (
        <span className='mx-1 hidden h-5 w-px bg-border sm:block' />
      )}
      {statusCounts.map(({ status, count }) => (
        <span
          key={status}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-md bg-muted/60 px-3 text-sm',
          )}
        >
          <span className='text-muted-foreground'>
            {status.replace(/_/g, ' ')}
          </span>
          <span className='font-semibold tabular-nums'>{count}</span>
        </span>
      ))}
    </div>
  )
}
