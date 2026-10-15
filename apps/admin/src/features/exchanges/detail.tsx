import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { exchangesApi, deriveExchangeType } from './api'
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

/**
 * Exchange detail (Task 7): Exchange badge + original-order link +
 * Return RTN link, dispatch + order status, derived Full/Partial type.
 */
export function ExchangeDetail() {
  const { id } = useParams({ from: '/_authenticated/op/exchanges/$id' })
  const navigate = useNavigate()

  const { data: order, isLoading } = useQuery({
    queryKey: ['exchange', id],
    queryFn: () => exchangesApi.get(id),
  })

  const { data: linked } = useQuery({
    queryKey: ['exchange-return', id],
    queryFn: () => exchangesApi.linkedReturn(id),
    retry: false,
  })

  const { data: original } = useQuery({
    queryKey: ['exchange-original-items', order && (order as { exchangeOfOrderId?: string }).exchangeOfOrderId],
    queryFn: () =>
      apiClient
        .get<{ items: { productId: string; variantId?: string | null; quantity: number }[] }>(
          `/orders/${(order as { exchangeOfOrderId?: string }).exchangeOfOrderId}`,
        )
        .then((r) => r.data),
    enabled: !!order && !!(order as { exchangeOfOrderId?: string }).exchangeOfOrderId && !!linked,
    retry: false,
  })

  if (isLoading || !order) {
    return (
      <>
        <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
        <Main className='flex flex-1 flex-col gap-4'>
          <Loader2 className='animate-spin h-6 w-6 mx-auto mt-16' />
        </Main>
      </>
    )
  }

  const o = order as {
    displayId: string
    status: { name: string }
    exchangeOfOrderId?: string | null
    exchangeOfOrder?: { id: string; displayId: string } | null
    dispatches?: { courier: string; status: string }[]
    courierService?: string | null
    createdAt: string
  }
  const exType = linked
    ? deriveExchangeType(original?.items ?? [], (linked as { items?: { productId: string; variantId?: string | null; quantity: number }[] }).items ?? [])
    : '—'

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-center gap-2'>
          <Button variant='ghost' size='sm' onClick={() => navigate({ to: '/op/exchanges' })}>
            <ArrowLeft className='h-4 w-4 mr-1' /> Exchanges
          </Button>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <h2 className='text-2xl font-bold tracking-tight font-mono'>{o.displayId}</h2>
          <span className='inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-600 dark:text-violet-400'>
            Exchange
          </span>
          <Badge variant='outline'>{o.status.name}</Badge>
          <Badge variant='outline'>{exType}</Badge>
        </div>

        <Card>
          <CardHeader><CardTitle className='text-sm'>Links</CardTitle></CardHeader>
          <CardContent className='space-y-2 text-sm'>
            <div className='flex justify-between'><span className='text-muted-foreground'>Original order</span>
              {o.exchangeOfOrder ? (
                <Link to='/op/orders/$id' params={{ id: o.exchangeOfOrder.id }} className='font-mono text-xs text-primary hover:underline'>{o.exchangeOfOrder.displayId}</Link>
              ) : <span className='text-xs text-muted-foreground'>—</span>}
            </div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Linked return</span>
              {linked ? (
                <Link to='/op/returns/$id' params={{ id: linked.id }} className='font-mono text-xs text-primary hover:underline'>{linked.displayId}</Link>
              ) : <span className='text-xs text-muted-foreground'>—</span>}
            </div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Return status</span>
              <span className='text-xs'>{linked?.status ?? '—'}</span>
            </div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Dispatch</span>
              <span className='text-xs'>{o.dispatches?.[0] ? `${o.dispatches[0].courier} · ${o.dispatches[0].status}` : (o.courierService ?? '—')}</span>
            </div>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
