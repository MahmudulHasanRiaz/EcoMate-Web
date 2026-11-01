import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ordersApi, type OrderResponse } from '@/features/orders/api'
import { dispatchApi, type DispatchResponse } from './api'

type AssignDispatchDialogProps = {
  dispatch: DispatchResponse | null
  onOpenChange: (open: boolean) => void
}

/**
 * Assign an UNMATCHED courier dispatch to an order (auto-connect,
 * 2026-11-01). The search starts from the invoice the courier carried —
 * that names the ORIGINAL order; its exchange orders appear in the same
 * results, so staff can pick the exchange the consignment belongs to.
 */
export function AssignDispatchDialog({
  dispatch,
  onOpenChange,
}: AssignDispatchDialogProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (dispatch) setSearch(dispatch.courierInvoiceRef ?? '')
  }, [dispatch])

  const { data, isFetching } = useQuery({
    queryKey: ['assign-dispatch-orders', search],
    queryFn: () =>
      ordersApi
        .list({ search: search || undefined, page: 1, perPage: 10 })
        .then((r) => r.data),
    enabled: !!dispatch,
  })
  const orders: OrderResponse[] = (data as any)?.data ?? []

  const assign = useMutation({
    mutationFn: (orderId: string) => dispatchApi.assign(dispatch!.id, orderId),
    onSuccess: () => {
      toast.success('Dispatch assigned to the order')
      queryClient.invalidateQueries({ queryKey: ['dispatches'] })
      onOpenChange(false)
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message || 'Failed to assign dispatch'),
  })

  return (
    <Dialog open={!!dispatch} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Assign dispatch to an order</DialogTitle>
          <DialogDescription>
            {dispatch
              ? `${dispatch.courier} consignment ${dispatch.consignmentId ?? '—'}` +
                (dispatch.courierInvoiceRef
                  ? ` was booked under invoice ${dispatch.courierInvoiceRef}. Pick the order it belongs to — for a courier-side exchange, pick the exchange order (Ex-…).`
                  : '. Pick the order this consignment belongs to.')
              : ''}
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder='Search by order number or phone…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className='max-h-80 overflow-auto rounded-md border'>
          {isFetching ? (
            <div className='flex h-24 items-center justify-center text-sm text-muted-foreground'>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' /> Searching…
            </div>
          ) : orders.length === 0 ? (
            <div className='flex h-24 items-center justify-center text-sm text-muted-foreground'>
              No orders found.
            </div>
          ) : (
            orders.map((o) => (
              <div
                key={o.id}
                className='flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0'
              >
                <div className='min-w-0'>
                  <div className='flex items-center gap-2'>
                    <span className='font-mono text-sm font-medium'>
                      {o.displayId}
                    </span>
                    {o.kind === 'EXCHANGE' && (
                      <Badge variant='secondary' className='text-[11px]'>
                        Exchange
                      </Badge>
                    )}
                    {o.exchangeOfOrder && (
                      <span className='truncate text-xs text-muted-foreground'>
                        of {o.exchangeOfOrder.displayId}
                      </span>
                    )}
                  </div>
                  <div className='truncate text-xs text-muted-foreground'>
                    {(o as any).status?.name ?? ''}
                    {(o as any).guestPhone
                      ? ` · ${(o as any).guestPhone}`
                      : (o as any).customer?.phone
                        ? ` · ${(o as any).customer.phone}`
                        : ''}
                  </div>
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7 shrink-0 px-2 text-xs'
                  disabled={assign.isPending}
                  onClick={() => assign.mutate(o.id)}
                >
                  <Link2 className='mr-1 h-3 w-3' />
                  Assign
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
