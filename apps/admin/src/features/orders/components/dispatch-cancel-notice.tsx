import { AlertTriangle, Truck } from 'lucide-react'

/**
 * Cancel a DISPATCHED order — the cancel dialog's dispatch notice (owner
 * directive, 2026-10-21).
 *
 * A dispatched order can only be cancelled while the parcel is still with us
 * AND the courier has a cancel API we can push to. The dialog must say so
 * BEFORE the staff confirms:
 *  - eligible → "This order's dispatch will also be cancelled with {courier}."
 *  - blocked  → WHY it cannot be cancelled (the confirm button is disabled).
 *
 * The eligibility itself is the server's authority (it rides on the order's
 * dispatches as `cancelEligibility`) — the UI only explains it.
 */

export type DispatchCancelState = {
  /** The dispatches that are still live (not CANCELLED). */
  live: any[]
  /** The live dispatches the server refuses to cancel. */
  blocked: any[]
  /** True when the order cannot be cancelled at all. */
  isBlocked: boolean
}

export function dispatchCancelState(dispatches: any[] | undefined): DispatchCancelState {
  const live = (dispatches ?? []).filter((d) => d?.status !== 'CANCELLED')
  const blocked = live.filter((d) => d?.cancelEligibility && !d.cancelEligibility.eligible)
  return { live, blocked, isBlocked: blocked.length > 0 }
}

export function DispatchCancelNotice({
  dispatches,
}: {
  dispatches: any[] | undefined
}) {
  const { live, blocked } = dispatchCancelState(dispatches)
  if (live.length === 0) return null

  if (blocked.length > 0) {
    return (
      <div className='rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10'>
        <p className='flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200'>
          <AlertTriangle className='h-4 w-4 shrink-0' />
          This order cannot be cancelled
        </p>
        {blocked.map((d: any) => (
          <p
            key={d.id}
            className='mt-1 text-xs text-amber-800 dark:text-amber-200'
          >
            {d.cancelEligibility?.reason}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-500/40 dark:bg-sky-500/10'>
      <p className='flex items-center gap-1.5 text-sm font-semibold text-sky-900 dark:text-sky-200'>
        <Truck className='h-4 w-4 shrink-0' />
        This order has a live dispatch
      </p>
      {live.map((d: any) => {
        const courierName = d.cancelEligibility?.courierLabel || d.courier
        const reference = d.consignmentId || d.trackingCode
        return (
          <div
            key={d.id}
            className='mt-1 text-xs text-sky-900 dark:text-sky-200'
          >
            <p className='font-medium'>
              {courierName}
              {reference ? ` · ${reference}` : ''}
            </p>
            <p>
              This order's dispatch will also be cancelled with {courierName}.
            </p>
          </div>
        )
      })}
    </div>
  )
}
