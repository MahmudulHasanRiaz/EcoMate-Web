import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { returnsApi } from '@/features/returns/api'
import { CreateReturnDialog } from './create-return-dialog'
import { ExchangeScopeDialog } from './exchange-scope-dialog'

/**
 * Menu labels — EXACT strings.
 *
 * HIGH §2 ONE button: exactly ONE staff return entry ('Create return').
 * The separate 'Create Partial Return Order' entry is deleted — the unified
 * CreateReturnDialog (Partial default) covers both FULL and PARTIAL via POST
 * /returns (courier auto-creation is backend-only and excepted).
 */
export const ORDER_ACTION_LABELS = {
  createReturn: 'Create return',
  createExchange: 'Create Exchange Order',
} as const

/**
 * Original-order statuses a staff return may be raised from (mirrors the
 * backend RETURN_ELIGIBLE_STATUSES guard — anything else is rejected with
 * "Order is not eligible for return", so the menu disables with the reason
 * instead of offering a doomed click).
 */
export const RETURN_ELIGIBLE_STATUSES: readonly string[] = [
  'Shipping',
  'Partial',
  'Delivered',
]

/** Non-null reason when a return cannot be raised from this order. */
export function returnBlockedReason(order: any, activeFullDisplayId?: string | null): string | null {
  if (activeFullDisplayId) {
    return (
      `Order already has an active return ${activeFullDisplayId}; ` +
      `close or cancel it first.`
    )
  }
  const status = order?.status?.name as string | undefined
  if (!RETURN_ELIGIBLE_STATUSES.includes(status as string)) {
    return (
      'Returns are allowed only from Shipping, Partial or Delivered status ' +
      `(current: ${status ?? 'unknown'}).`
    )
  }
  return null
}

/**
 * Original-order statuses an exchange may be raised from (mirrors the
 * backend EXCHANGE_ALLOWED_ORIGINAL_STATUSES gate — kind-only creation
 * would force Return Pending past ORDER_TRANSITIONS).
 */
export const EXCHANGE_ALLOWED_STATUSES: readonly string[] = [
  'Shipping',
  'Delivered',
  'Partial',
  'Return Pending',
]

/** Non-null reason when a SALE order's status disallows exchange creation. */
export function exchangeBlockedReason(order: any): string | null {
  if (order?.kind !== 'SALE') return null // kind gate hides instead
  const status = order?.status?.name as string | undefined
  if (!EXCHANGE_ALLOWED_STATUSES.includes(status as string)) {
    return (
      'Exchanges are allowed only from Shipping, Delivered, Partial or ' +
      `Return Pending status (current: ${status ?? 'unknown'}).`
    )
  }
  return null
}

export interface OrderActionDef {
  key: 'create-return' | 'create-exchange' | string
  label: string
  icon: React.ReactNode
  /** Per-order visibility (kind/trashed gating lives here, not in callers). */
  visible: (order: any) => boolean
  /** Per-order disablement (status gating surfaces a reason, not a hide). */
  disabled?: (order: any) => boolean
  disabledReason?: (order: any) => string | null
  run: () => void
}

/**
 * Plus (+) order action menu on the order detail page (Task 4 Fix 8).
 *
 * EXTENSIBLE: new actions are one entry in the `actions` array below
 * (key + EXACT label + icon + visibility + run) — no toolbar surgery.
 * T7 owns the Returns/Exchanges LISTS; this menu only creates records.
 *
 * Return hardening: there is exactly ONE return entry ('Create return'),
 * opening the unified modal — staff returns are NEVER created one-click
 * from this menu (the old instant FULL POST is deleted; courier
 * auto-creation is backend-only and untouched).
 */
export function OrderActionMenu({ order }: { order: any }) {
  const [returnOpen, setReturnOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)

  // Display-only guard mirror: an active FULL names itself in the tooltip.
  // The backend guard is still the authority — this only avoids doomed clicks.
  const { data: linked } = useQuery({
    queryKey: ['order-returns', order.id],
    queryFn: () => returnsApi.list({ orderId: order.id, limit: 100 }).then((r) => r.data),
    enabled: !!order?.id,
    staleTime: 15_000,
  })
  const activeFull = useMemo(
    () => (linked ?? []).find((r: any) => r?.status !== 'CLOSED' && r?.type === 'FULL') as any | undefined,
    [linked],
  )

  const actions: OrderActionDef[] = [
    {
      key: 'create-return',
      label: ORDER_ACTION_LABELS.createReturn,
      icon: <RotateCcw className='h-4 w-4 mr-2' />,
      visible: (o) => o.kind !== 'RETURN',
      disabled: () => returnBlockedReason(order, activeFull?.displayId ?? activeFull?.id) !== null,
      disabledReason: () => returnBlockedReason(order, activeFull?.displayId ?? activeFull?.id),
      run: () => setReturnOpen(true),
    },
    {
      key: 'create-exchange',
      label: ORDER_ACTION_LABELS.createExchange,
      icon: <ArrowRightLeft className='h-4 w-4 mr-2' />,
      visible: (o) => o.kind === 'SALE',
      disabled: (o) => exchangeBlockedReason(o) !== null,
      disabledReason: (o) => exchangeBlockedReason(o),
      run: () => setScopeOpen(true),
    },
  ]

  const visible = actions.filter((a) => a.visible(order))
  if (order?.trashedAt || visible.length === 0) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' size='sm' className='h-8 px-2.5 shadow-2xs' aria-label='Order actions'>
            <Plus className='h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-56'>
          {visible.map((a) => (
            <DropdownMenuItem
              key={a.key}
              onClick={a.run}
              disabled={a.disabled?.(order) ?? false}
              title={a.disabledReason?.(order) ?? undefined}
            >
              {a.icon} {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateReturnDialog order={order} open={returnOpen} onClose={() => setReturnOpen(false)} />
      <ExchangeScopeDialog order={order} open={scopeOpen} onClose={() => setScopeOpen(false)} />
    </>
  )
}
