import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { exchangesApi, deriveExchangeType } from './api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SafeImage } from '@/components/safe-image'
import { variantLabel } from '@/lib/product-variant'
import { resolveOrderItemImages } from '@/lib/product-image'
import { cn } from '@/lib/utils'

/** Loose structural typing — order comes from the shared order-detail page payload. */
export interface ExchangeSectionItem {
  productId?: string | null
  variantId?: string | null
  quantity?: number | string | null
  price?: number | string | null
  product?: { name?: string | null; sku?: string | null; images?: string[] | null } | null
  variant?: {
    sku?: string | null
    image?: string | null
    images?: string[] | null
    attributeValues?: { attributeValue?: { value?: string | null; hexCode?: string | null; attribute?: { name?: string | null } | null } }[] | null
  } | null
}

export interface ExchangeSectionOrder {
  id?: string
  displayId?: string
  kind?: string | null
  exchangeScope?: string | null
  exchangeOfOrderId?: string | null
  exchangedCreditAmount?: number | string | null
  settlementDelta?: number | string | null
  settlementStatus?: string | null
  settlementSettledAt?: string | Date | null
  exchangeOfOrder?: {
    id?: string | null
    displayId?: string | null
    items?: ExchangeSectionItem[] | null
  } | null
  items?: ExchangeSectionItem[] | null
  payments?: {
    id?: string
    sourceOrderId?: string | null
    sourcePaymentId?: string | null
    status?: string | null
    amount?: number | string | null
  }[] | null
}

const fmt = (v: number | string | null | undefined): string => {
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : '0'
}

const STATUS_LABEL: Record<string, string> = {
  SETTLED_DUE: 'Settled due',
  EXACT: 'Settled exact',
  REFUND: 'Refunded',
}

function GoodsRows({ items }: { items: ExchangeSectionItem[] | null | undefined }) {
  const rows = items ?? []
  if (!rows.length) return <p className='text-xs text-muted-foreground'>No line items recorded.</p>
  return (
    <div className='space-y-1.5'>
      {rows.map((l, i) => {
        const name = l?.product?.name ?? '—'
        const img = resolveOrderItemImages(l?.product, l?.variant).image
        const sku = l?.variant?.sku || l?.product?.sku || ''
        return (
          <div key={`${l?.productId ?? 'x'}::${l?.variantId ?? i}`} className='flex items-center gap-2 py-1'>
            <SafeImage src={img} alt={name} className='h-9 w-9 rounded border object-cover shrink-0' />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium'>{name}</p>
              <p className='text-xs text-muted-foreground truncate'>
                {variantLabel(l?.variant)}
                {sku ? <span className='font-mono'> · {sku}</span> : null}
              </p>
            </div>
            <span className='shrink-0 text-xs font-medium'>
              × {Number(l?.quantity ?? 0)}
              {Number(l?.price ?? 0) > 0 ? <span className='text-muted-foreground'> · ৳{fmt(l?.price)}</span> : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Exchange-specific section rendered INSIDE the shared order detail page when
 * the loaded order is an EXCHANGE: type chip (exchangeScope, falling back to
 * the linked return derivation), identity links, old-vs-new goods comparison
 * and the billing settlement rows. Plain orders never render it (guard below).
 */
export function ExchangeOrderSection({ order }: { order: ExchangeSectionOrder | null | undefined }) {
  const o = order ?? null
  const original = o?.exchangeOfOrder ?? null

  // One linked-return fetch feeds BOTH the Linked-return link/status row and
  // the scope fallback derivation (only read when exchangeScope is null).
  const { data: linked } = useQuery({
    queryKey: ['exchange-linked-return', o?.id],
    queryFn: () => exchangesApi.linkedReturn(o!.id!),
    enabled: !!o?.id,
    retry: false,
  })

  // Guard AFTER the hook (rules of hooks) — plain orders render nothing.
  if (!o || (o as { kind?: string | null }).kind !== 'EXCHANGE') return null

  const chip = o.exchangeScope
    ? String(o.exchangeScope).toUpperCase()
    : String(deriveExchangeType(original?.items ?? [], (linked as { items?: ExchangeSectionItem[] } | null)?.items ?? [])).toUpperCase()

  const credit = o.exchangedCreditAmount
  const delta = o.settlementDelta
  const deltaNum = Number(delta)
  const statusLabel = o.settlementStatus ? (STATUS_LABEL[o.settlementStatus] ?? o.settlementStatus) : null
  const settledAt = o.settlementSettledAt
    ? new Date(o.settlementSettledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  // Source payment → the payment row that BOOKED credit against the original.
  const payments = o.payments ?? []
  const srcPayment = payments.find((p) => p.sourceOrderId) ?? payments.find((p) => p.sourcePaymentId) ?? null
  const srcHref = srcPayment ? `/op/orders/${srcPayment.sourceOrderId ?? o.exchangeOfOrderId ?? ''}` : null
  const srcLabel = srcPayment ? (original?.displayId ?? 'Source payment') : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-sm flex items-center gap-2'>
          Payment on exchange
          <span className='inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-600 dark:text-violet-400'>
            {chip}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-2 text-sm sm:grid-cols-3'>
          <div className='flex justify-between gap-2'>
            <span className='text-muted-foreground shrink-0'>Original order</span>
            {original?.id ? (
              <Link
                to='/op/orders/$id'
                params={{ id: original.id }}
                className='font-mono text-xs text-primary hover:underline'
              >
                {original.displayId}
              </Link>
            ) : (
              <span className='text-xs text-muted-foreground'>—</span>
            )}
          </div>
          <div className='flex justify-between gap-2'>
            <span className='text-muted-foreground shrink-0'>Linked return</span>
            {linked?.id ? (
              <Link
                to='/op/returns/$id'
                params={{ id: linked.id }}
                className='font-mono text-xs text-primary hover:underline'
              >
                {linked.displayId}
              </Link>
            ) : (
              <span className='text-xs text-muted-foreground'>—</span>
            )}
          </div>
          <div className='flex justify-between gap-2'>
            <span className='text-muted-foreground shrink-0'>Return status</span>
            <span className='text-xs truncate'>{(linked as { status?: string | null } | null)?.status ?? '—'}</span>
          </div>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <div className='min-w-0'>
            <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Returned goods</p>
            <GoodsRows items={original?.items ?? []} />
          </div>
          <div className='min-w-0'>
            <p className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Exchanged for</p>
            <GoodsRows items={o.items ?? []} />
          </div>
        </div>

        <div className='grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4'>
          <div className='rounded-lg border bg-muted/30 px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Credit consumed</p>
            <p className='font-semibold'>{credit === null || credit === undefined ? '—' : `৳${fmt(credit)}`}</p>
          </div>
          <div className='rounded-lg border bg-muted/30 px-3 py-2'>
            <p className='text-xs text-muted-foreground'>
              {deltaNum > 0 ? 'Collect on delivery' : deltaNum < 0 ? 'Refund pending' : 'No settlement due'}
            </p>
            <p className={cn('font-semibold', deltaNum > 0 && 'text-amber-600 dark:text-amber-400', deltaNum < 0 && 'text-rose-600 dark:text-rose-400')}>
              {delta === null || delta === undefined
                ? '—'
                : `${deltaNum > 0 ? '+' : deltaNum < 0 ? '−' : ''}৳${fmt(Math.abs(deltaNum))}`}
            </p>
          </div>
          <div className='rounded-lg border bg-muted/30 px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Settlement</p>
            <p>
              {statusLabel ? <span className='font-semibold'>{statusLabel}</span> : <span className='text-muted-foreground'>—</span>}
              {settledAt ? <span className='ml-1 text-xs text-muted-foreground'>· {settledAt}</span> : null}
            </p>
          </div>
          <div className='rounded-lg border bg-muted/30 px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Source</p>
            <p>
              {srcPayment && srcHref ? (
                <Link
                  to='/op/orders/$id'
                  params={{ id: srcPayment.sourceOrderId ?? o.exchangeOfOrderId ?? '' }}
                  className='font-medium text-primary hover:underline'
                >
                  Source payment · {srcLabel}
                </Link>
              ) : (
                <span className='text-muted-foreground'>—</span>
              )}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
