import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { returnsApi } from './api'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, ArrowLeft } from 'lucide-react'
import { stockLabel } from './index'

const errMsg = (e: unknown): string => {
  const err = e as { response?: { data?: { message?: string } }; message?: string }
  return err?.response?.data?.message ?? err?.message ?? 'Request failed'
}

/**
 * Return detail (Task 7): status, items, reason, courier return ID,
 * stock state, refund link (deep-link to payment list per D-B), exchange
 * link, original-order link. Actions: Check return status (POST reconcile
 * with the original consignment id), Mark received (RECEIVED → item-level
 * restore → RESTOCKED; order untouched).
 */
export function ReturnDetail() {
  const { id } = useParams({ from: '/_authenticated/op/returns/$id' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [checking, setChecking] = useState(false)

  const { data: ret, isLoading } = useQuery({
    queryKey: ['return', id],
    queryFn: () => returnsApi.get(id),
  })

  const { data: order } = useQuery({
    queryKey: ['order-consignment', ret?.orderId],
    queryFn: () => apiClient.get(`/orders/${ret!.orderId}`).then((r) => r.data as { courierConsignmentId?: string | null }),
    enabled: !!ret?.orderId,
    retry: false,
  })

  const markMut = useMutation({
    mutationFn: () => returnsApi.markReceived(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['return', id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      toast.success(`Return ${updated?.displayId ?? ''} marked received — stock restored item-level.`)
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const checkStatus = async () => {
    const consignmentId = order?.courierConsignmentId
    if (!consignmentId) {
      toast.error('No courier consignment on the original order — nothing to reconcile.')
      return
    }
    setChecking(true)
    try {
      const res = await returnsApi.checkReturnStatus(consignmentId)
      queryClient.invalidateQueries({ queryKey: ['return', id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      toast.success(res?.reconciled ? `Reconciled: ${res.deliveryStatus}` : (res?.reason ?? 'Checked'))
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setChecking(false)
    }
  }

  if (isLoading || !ret) {
    return (
      <>
        <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
        <Main className='flex flex-1 flex-col gap-4'>
          <Loader2 className='animate-spin h-6 w-6 mx-auto mt-16' />
        </Main>
      </>
    )
  }

  const paymentDeepLink = ret.order
    ? `/op/payments?order=${encodeURIComponent(ret.order.displayId)}`
    : '/op/payments'

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' onClick={() => navigate({ to: '/op/returns' })}>
            <ArrowLeft className='h-4 w-4 mr-1' /> Returns
          </Button>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <h2 className='text-2xl font-bold tracking-tight font-mono'>{ret.displayId}</h2>
          <Badge variant='outline'>{ret.type}</Badge>
          <Badge variant='outline'>{ret.status}</Badge>
          <Badge variant='outline'>{ret.source}</Badge>
          <Badge variant={ret.stockReconciled ? 'default' : 'secondary'}>
            {stockLabel(ret)}
          </Badge>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader><CardTitle className='text-sm'>Return</CardTitle></CardHeader>
            <CardContent className='space-y-2 text-sm'>
              <div className='flex justify-between'><span className='text-muted-foreground'>Reason</span><span>{ret.reason || '—'}</span></div>
              <div className='flex justify-between'><span className='text-muted-foreground'>Courier</span><span className='capitalize'>{ret.courier || '—'}</span></div>
              <div className='flex justify-between'><span className='text-muted-foreground'>Courier return ID</span><span className='font-mono text-xs'>{ret.courierReturnId || '—'}</span></div>
              <div className='flex justify-between'><span className='text-muted-foreground'>Courier status</span><span className='font-mono text-xs'>{ret.courierStatus || '—'}</span></div>
              <div className='flex justify-between'><span className='text-muted-foreground'>Original order</span>
                {ret.order ? (
                  <Link to='/op/orders/$id' params={{ id: ret.order.id }} className='font-mono text-xs text-primary hover:underline'>{ret.order.displayId}</Link>
                ) : <span className='font-mono text-xs'>{ret.orderId.slice(0, 8)}</span>}
              </div>
              <div className='flex justify-between'><span className='text-muted-foreground'>Exchange order</span>
                {ret.exchangeOrder ? (
                  <Link to='/op/exchanges/$id' params={{ id: ret.exchangeOrder.id }} className='font-mono text-xs text-primary hover:underline'>{ret.exchangeOrder.displayId}</Link>
                ) : <span className='text-xs text-muted-foreground'>—</span>}
              </div>
              <div className='flex justify-between'><span className='text-muted-foreground'>Refund</span>
                {ret.refundId ? (
                  <a href={paymentDeepLink} className='font-mono text-xs text-primary hover:underline'>{ret.refundId.slice(0, 8)} · payment list</a>
                ) : (
                  <a href={paymentDeepLink} className='text-xs text-primary hover:underline'>Refund from payment list</a>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className='text-sm'>Items ({ret.items?.length ?? 0} lines)</CardTitle></CardHeader>
            <CardContent className='space-y-1.5 text-sm'>
              {(ret.items ?? []).length ? (ret.items ?? []).map((l, i) => (
                <div key={i} className='flex justify-between'>
                  <span className='font-mono text-xs'>{String(l.productId).slice(0, 8)}</span>
                  <span className='text-xs'>× {l.quantity}</span>
                </div>
              )) : <p className='text-xs text-muted-foreground'>Quantities unknown — the courier never reports the split. Confirm exact quantities at mark-received.</p>}
            </CardContent>
          </Card>
        </div>

        <div className='flex flex-wrap gap-2'>
          <Button size='sm' variant='outline' onClick={checkStatus} disabled={checking || !order?.courierConsignmentId}>
            {checking ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' /> : null}
            Check return status
          </Button>
          <Button size='sm' onClick={() => markMut.mutate()} disabled={markMut.isPending || ret.status === 'RESTOCKED' || ret.status === 'CLOSED'}>
            {markMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' /> : null}
            Mark received
          </Button>
        </div>
      </Main>
    </>
  )
}
