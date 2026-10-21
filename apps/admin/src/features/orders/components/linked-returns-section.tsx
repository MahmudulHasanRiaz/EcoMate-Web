import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SafeImage } from '@/components/safe-image'
import { returnsApi } from '@/features/returns/api'
import { exchangeApi } from '@/features/orders/api'
import { variantLabel } from '@/lib/product-variant'
import { resolveOrderItemImages } from '@/lib/product-image'

/**
 * Order-detail "Linked returns & exchanges" section (return hardening).
 *
 * RTN rows come from the Returns list API scoped to this order (type,
 * status, link, the receiving staff member and the order's line items so the
 * section can show WHAT is in each return); exchange rows come from the
 * exchange readiness endpoint (displayId, delivery state, the exchange
 * order's product lines, link). Closed returns stay visible as history —
 * only CLOSED hides from the guards, never from this list.
 */

/** One product line of a return / exchange, as the section renders it. */
type Line = {
  key: string
  name: string
  variantLabel: string
  sku: string
  image: string | null
  quantity: number
  damaged: boolean
}

/** "Received by {name} · {date, time}" — date only when there is no actor. */
function receivedByLine(r: any): string | null {
  if (!r?.receivedAt) return null
  const when = new Date(r.receivedAt)
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
  const receiver = r.receivedBy
  const actor: string | null = receiver
    ? [receiver.firstName, receiver.lastName].filter(Boolean).join(' ').trim() ||
      receiver.email ||
      receiver.id
    : null
  return actor ? `Received by ${actor}${stamp ? ` · ${stamp}` : ''}` : stamp || null
}

/** The return's own lines (return quantities) resolved against the order's
 *  line items (product image/name/SKU). */
function returnLines(ret: any): Line[] {
  const orderItems: any[] = ret?.order?.items ?? []
  const byKey = new Map<string, any>()
  for (const it of orderItems) {
    byKey.set(`${it.productId}::${it.variantId ?? ''}`, it)
  }
  const rows: any[] = Array.isArray(ret?.items) ? ret.items : []
  const out: Line[] = []
  for (const row of rows) {
    const key = `${row.productId}::${row.variantId ?? ''}`
    const orderLine = byKey.get(key)
    const product = orderLine?.product
    const variant = orderLine?.variant
    const image = orderLine
      ? resolveOrderItemImages(product, variant).image
      : null
    out.push({
      key,
      name: product?.name ?? `Product ${String(row.productId).slice(0, 8)}`,
      variantLabel: variantLabel(variant),
      sku: variant?.sku || product?.sku || '',
      image,
      quantity: Number(row.quantity) || 0,
      damaged: (Number(row.damagedQuantity) || 0) > 0,
    })
  }
  return out
}

/** The exchange order's own product lines. */
function exchangeLines(ex: any): Line[] {
  const rows: any[] = Array.isArray(ex?.items) ? ex.items : []
  return rows.map((it: any) => ({
    key: `${it.productId}::${it.variantId ?? ''}`,
    name: it.productName ?? `Product ${String(it.productId).slice(0, 8)}`,
    variantLabel: (it.variantAttributes ?? [])
      .map((a: any) => (a.attributeName ? `${a.attributeName}: ${a.value}` : a.value))
      .filter(Boolean)
      .join(' · '),
    sku: it.variantSku || it.productSku || '',
    image:
      (it.variantImage ?? null) ||
      (Array.isArray(it.variantImages) ? it.variantImages[0] ?? null : null) ||
      (Array.isArray(it.productImages) ? it.productImages[0] ?? null : null),
    quantity: Number(it.quantity) || 0,
    damaged: false,
  }))
}

function LineList({ lines }: { lines: Line[] }) {
  if (lines.length === 0) return null
  return (
    <ul className='mt-1.5 space-y-1'>
      {lines.map((line) => (
        <li key={line.key} className='flex items-center gap-2 text-xs'>
          <SafeImage
            src={line.image}
            alt={line.name}
            className='h-7 w-7 rounded border object-cover shrink-0'
          />
          <span className='truncate text-foreground'>{line.name}</span>
          {line.variantLabel ? (
            <span className='truncate text-muted-foreground'>{line.variantLabel}</span>
          ) : null}
          {line.sku ? <span className='font-mono text-muted-foreground'>{line.sku}</span> : null}
          {line.damaged ? (
            <span className='text-amber-600 dark:text-amber-400 shrink-0'>damaged</span>
          ) : null}
          <span className='ml-auto shrink-0 tabular-nums text-muted-foreground'>
            {`× ${line.quantity}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

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
        {rtnRows.map((r: any) => {
          const lines = returnLines(r)
          const received = receivedByLine(r)
          return (
            <div key={r.id} className='rounded-lg border border-border/50 px-2.5 py-2'>
              <div className='flex items-center gap-2 text-xs flex-wrap'>
                <RotateCcw className='h-3.5 w-3.5 text-pink-500 shrink-0' />
                <Link to='/op/returns/$id' params={{ id: r.id }} className='font-mono font-semibold text-primary hover:underline'>
                  {r.displayId}
                </Link>
                <Badge variant='outline' className='text-[10px]'>{r.type}</Badge>
                <span className='ml-auto text-muted-foreground'>{r.status}</span>
              </div>
              {received ? (
                <p className='text-[11px] text-muted-foreground mt-1'>{received}</p>
              ) : null}
              <LineList lines={lines} />
            </div>
          )
        })}
        {exRows.map((e: any) => (
          <div key={e.id} className='rounded-lg border border-border/50 px-2.5 py-2'>
            <div className='flex items-center gap-2 text-xs flex-wrap'>
              <ArrowRightLeft className='h-3.5 w-3.5 text-violet-500 shrink-0' />
              <Link to='/op/orders/$id' params={{ id: e.id }} className='font-mono font-semibold text-primary hover:underline'>
                {e.displayId}
              </Link>
              <Badge variant='outline' className='text-[10px]'>Exchange</Badge>
              <span className={`ml-auto font-medium ${e.delivered ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {e.delivered ? 'Delivered' : 'In progress'}
              </span>
            </div>
            <LineList lines={exchangeLines(e)} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
