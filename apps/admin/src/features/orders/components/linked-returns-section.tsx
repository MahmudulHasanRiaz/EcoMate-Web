import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { returnsApi } from '@/features/returns/api'
import { exchangeApi } from '@/features/orders/api'

/**
 * Order-detail "Linked returns & exchanges" section (return hardening).
 *
 * RTN rows come from the Returns list API scoped to this order (type,
 * status, link); exchange rows come from the exchange readiness endpoint
 * (displayId, delivery state, link). Closed returns stay visible as history
 * — only CLOSED hides from the guards, never from this list.
 */
export function LinkedReturnsSection({ orderId }: { orderId: string }) {
  const { data: returns } = useQuery({
    queryKey: ['order-returns', orderId],
    queryFn: () => returnsApi.list({ orderId, limit: 100 }).then((r) => r.data),
    enabled: !!orderId,
    staleTime: 15_000,
  })
  const { data: ready } = useQuery({
    queryKey: ['exchange-readiness', orderId],
    queryFn: () => exchangeApi.readiness(orderId),
    enabled: !!orderId,
    staleTime: 15_000,
  })

  const rtnRows = returns ?? []
  const exRows = ready?.exchanges ?? []
  const empty = rtnRows.length === 0 && exRows.length === 0

  // Nothing linked → nothing rendered. An empty card is noise on every order
  // that never had a return or exchange.
  if (empty) return null

  return (
    <Card className='overflow-hidden border border-border/70 shadow-xs'>
      <CardHeader className='bg-muted/30 border-b border-border/50 py-2.5 px-3.5 sm:py-3.5 sm:px-6'>
        <div className='flex items-center gap-2.5'>
          <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold'>
            <ArrowRightLeft className='h-4 w-4' />
          </div>
          <div>
            <CardTitle className='text-sm font-semibold tracking-tight text-foreground flex items-center gap-2'>
              Linked returns &amp; exchanges
            </CardTitle>
            <p className='text-xs text-muted-foreground mt-0.5'>Every return and exchange leg raised against this order</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className='p-3 sm:p-6 flex flex-col gap-2'>
        {rtnRows.map((r: any) => (
          <div key={r.id} className='flex items-center gap-2 text-xs flex-wrap rounded-lg border border-border/50 px-2.5 py-2'>
            <RotateCcw className='h-3.5 w-3.5 text-pink-500 shrink-0' />
            <Link to='/op/returns/$id' params={{ id: r.id }} className='font-mono font-semibold text-primary hover:underline'>
              {r.displayId}
            </Link>
            <Badge variant='outline' className='text-[10px]'>{r.type}</Badge>
            <span className='text-muted-foreground ml-auto'>{r.status}</span>
          </div>
        ))}
        {exRows.map((e: any) => (
          <div key={e.id} className='flex items-center gap-2 text-xs flex-wrap rounded-lg border border-border/50 px-2.5 py-2'>
            <ArrowRightLeft className='h-3.5 w-3.5 text-violet-500 shrink-0' />
            <Link to='/op/orders/$id' params={{ id: e.id }} className='font-mono font-semibold text-primary hover:underline'>
              {e.displayId}
            </Link>
            <Badge variant='outline' className='text-[10px]'>Exchange</Badge>
            <span className={`ml-auto font-medium ${e.delivered ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {e.delivered ? 'Delivered' : 'In progress'}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
