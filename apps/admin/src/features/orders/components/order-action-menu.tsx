import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRightLeft, Plus, RotateCcw, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { returnsApi } from '@/features/orders/api'
import { PartialReturnDialog } from './partial-return-dialog'
import { ExchangeScopeDialog } from './exchange-scope-dialog'

/** Menu labels — EXACT strings (owner-locked, Task 4 Fix 8). */
export const ORDER_ACTION_LABELS = {
  createReturn: 'Create Return Order',
  createExchange: 'Create Exchange Order',
  createPartialReturn: 'Create Partial Return Order',
} as const

export interface OrderActionDef {
  key: 'create-return' | 'create-exchange' | 'create-partial-return' | string
  label: string
  icon: React.ReactNode
  /** Per-order visibility (kind/trashed gating lives here, not in callers). */
  visible: (order: any) => boolean
  run: () => void
}

const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  return 'Failed to create the return.'
}

/**
 * Plus (+) order action menu on the order detail page (Task 4 Fix 8).
 *
 * EXTENSIBLE: new actions are one entry in the `actions` array below
 * (key + EXACT label + icon + visibility + run) — no toolbar surgery.
 * T7 owns the Returns/Exchanges LISTS; this menu only creates records.
 */
export function OrderActionMenu({ order }: { order: any }) {
  const queryClient = useQueryClient()
  const [scopeOpen, setScopeOpen] = useState(false)
  const [partialOpen, setPartialOpen] = useState(false)

  // 'Create Return Order' → Return FULL create (unified Return record —
  // best-effort full snapshot from the order lines; receive-time confirms
  // quantities, same as the courier-sourced flow).
  const fullReturnMut = useMutation({
    mutationFn: () =>
      returnsApi.create({
        orderId: order.id,
        type: 'FULL',
        source: 'STAFF',
        items: (order?.items ?? [])
          .filter((i: any) => i.productId)
          .map((i: any) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity })),
      }),
    onSuccess: (ret: any) => {
      queryClient.invalidateQueries({ queryKey: ['order', order.id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      toast.success(`Return ${ret?.displayId ?? ''} created — original stays Return Pending until receipt.`)
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const actions: OrderActionDef[] = [
    {
      key: 'create-return',
      label: ORDER_ACTION_LABELS.createReturn,
      icon: <RotateCcw className='h-4 w-4 mr-2' />,
      visible: (o) => o.kind !== 'RETURN',
      run: () => fullReturnMut.mutate(),
    },
    {
      key: 'create-exchange',
      label: ORDER_ACTION_LABELS.createExchange,
      icon: <ArrowRightLeft className='h-4 w-4 mr-2' />,
      visible: (o) => o.kind === 'SALE',
      run: () => setScopeOpen(true),
    },
    {
      key: 'create-partial-return',
      label: ORDER_ACTION_LABELS.createPartialReturn,
      icon: <Scissors className='h-4 w-4 mr-2' />,
      visible: (o) => o.kind !== 'RETURN',
      run: () => setPartialOpen(true),
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
            <DropdownMenuItem key={a.key} onClick={a.run} disabled={a.key === 'create-return' && fullReturnMut.isPending}>
              {a.icon} {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ExchangeScopeDialog order={order} open={scopeOpen} onClose={() => setScopeOpen(false)} />
      <PartialReturnDialog order={order} open={partialOpen} onClose={() => setPartialOpen(false)} />
    </>
  )
}
