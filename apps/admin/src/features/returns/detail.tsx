import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { returnsApi, type ReturnOrderItem } from './api'
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
import { CustomerContactActions } from '@/components/customer-contact-actions'
import { SafeImage } from '@/components/safe-image'
import { getCustomerDisplayName, getCustomerPhone } from '@/lib/order-display'
import { variantLabel } from '@/lib/product-variant'
import { resolveOrderItemImages } from '@/lib/product-image'
import { cn } from '@/lib/utils'

const errMsg = (e: unknown): string => {
  const err = e as { response?: { data?: { message?: string } }; message?: string }
  return err?.response?.data?.message ?? err?.message ?? 'Request failed'
}

/** Type badge tint — the accident spotter leans on color coding. */
const TYPE_BADGE_CLASS: Record<string, string> = {
  FULL: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
  PARTIAL: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  EXCHANGE:
    'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
}

/** Coverage label color — FULL green, PARTIAL amber, EXCHANGE violet. */
const COVERAGE_TEXT_CLASS: Record<string, string> = {
  FULL: 'text-emerald-700 dark:text-emerald-400',
  PARTIAL: 'text-amber-700 dark:text-amber-400',
  EXCHANGE: 'text-violet-700 dark:text-violet-400',
}

const sumQty = (rows: { quantity?: number | string }[] | null | undefined): number =>
  (rows ?? []).reduce((s, r) => s + Number(r?.quantity ?? 0), 0)

const fmt = (n: number): string =>
  Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '0'

interface Coverage {
  unknown: boolean
  x: number
  y: number
}

const coverageFor = (
  orderLines: ReturnOrderItem[] | null | undefined,
  returnItems: { productId: string; variantId?: string | null; quantity: number }[] | null | undefined,
): Coverage => {
  const retRows = returnItems ?? []
  if (retRows.length === 0) return { unknown: true, x: 0, y: 0 }
  return { unknown: false, x: sumQty(retRows), y: sumQty(orderLines) }
}

const coverageLabelFor = (type: string, c: Coverage): string => {
  if (type === 'FULL') return `FULL — all ${c.y} items`
  if (type === 'EXCHANGE') return `EXCHANGE — ${c.x} of ${c.y} items`
  return `PARTIAL — ${c.x} of ${c.y} items`
}

/** Red contradiction warnings — the owner's real accident must catch the eye. */
const contradictionFor = (type: string, c: Coverage): string | null => {
  if (c.unknown || c.y <= 0) return null
  if (type === 'PARTIAL' && c.x > 0 && c.x >= c.y)
    return `PARTIAL return covers ALL ${c.y} ordered items — verify this is not a FULL-return mistake.`
  if (type === 'FULL' && c.x < c.y)
    return `FULL return covers only ${c.x} of ${c.y} — some ordered items are missing.`
  return null
}

/**
 * Return detail: coverage accident-spotter, customer snapshot card
 * (shared contact actions), order line items joined with returned qty,
 * meta links and both action buttons (Check status; Mark received).
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

  const retRows = ret.items ?? []
  const orderLines = ret.order?.items ?? []
  const coverage = coverageFor(orderLines, retRows)
  const contradiction = contradictionFor(ret.type as string, coverage)
  const returnedByKey = new Map<string, number>()
  for (const l of retRows) {
    returnedByKey.set(`${l.productId}::${l.variantId ?? ''}`, Number(l.quantity ?? 0))
  }
  // Return rows without an order-line snapshot (legacy/edge): never silently dropped.
  const orphanRows = retRows.filter(
    (l) => !orderLines.some((o) => o.productId === l.productId && (o.variantId ?? '') === (l.variantId ?? '')),
  )
  const paymentDeepLink = ret.order
    ? `/op/payments?order=${encodeURIComponent(ret.order.displayId)}`
    : '/op/payments'
  const snapshot = ret.order
  const customerName = snapshot ? getCustomerDisplayName(snapshot) : '—'
  const customerPhone = snapshot ? getCustomerPhone(snapshot) : ''
  const secondaryPhone = snapshot?.secondaryPhone || ''
  const createdDate = ret.createdAt
    ? new Date(ret.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

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
          <Badge variant='outline' className={TYPE_BADGE_CLASS[ret.type as string] ?? undefined}>{ret.type}</Badge>
          <Badge variant='outline'>{ret.status}</Badge>
          <Badge variant='outline'>{ret.source}</Badge>
          <Badge variant={ret.stockReconciled ? 'default' : 'secondary'}>
            {stockLabel(ret)}
          </Badge>
          <span className='ms-auto text-xs text-muted-foreground'>
            Created {createdDate}
            <span className='hidden sm:inline'> · Created by {ret.createdBy || '—'}</span>
          </span>
        </div>

        {/* Coverage accident-spotter */}
        <div className='rounded-lg border bg-card p-4 space-y-2'>
          {coverage.unknown ? (
            <p className='text-sm font-medium'>
              Coverage quantities not confirmed — the courier never reports the split; confirm exact quantities at mark-received.
            </p>
          ) : coverage.y <= 0 ? (
            <p className='text-sm font-medium'>
              Order line items unavailable — coverage cannot be computed from this order record.
            </p>
          ) : (
            <>
              <p className='text-base font-semibold leading-snug'>
                {`This return covers ${coverage.x} of ${coverage.y} items from ${snapshot?.displayId ?? 'the original order'}`}
              </p>
              <p className={cn('text-sm font-semibold', COVERAGE_TEXT_CLASS[ret.type as string] ?? '')}>
                {coverageLabelFor(ret.type as string, coverage)}
              </p>
            </>
          )}
          {contradiction ? (
            <p className='rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300'>
              {contradiction}
            </p>
          ) : null}
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          <Card>
            <CardHeader><CardTitle className='text-sm'>Customer</CardTitle></CardHeader>
            <CardContent className='space-y-2 text-sm'>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-muted-foreground shrink-0'>Name</span>
                <span className='truncate font-medium'>{customerName}</span>
              </div>
              <div className='flex items-center justify-between gap-2'>
                <span className='text-muted-foreground shrink-0'>Phone</span>
                {customerPhone ? (
                  <span className='flex items-center gap-1 min-w-0'>
                    <a href={`tel:${customerPhone}`} className='font-mono text-xs hover:underline'>
                      {customerPhone}
                    </a>
                    <CustomerContactActions phone={customerPhone} />
                  </span>
                ) : (
                  <span className='text-xs text-muted-foreground'>—</span>
                )}
              </div>
              {secondaryPhone ? (
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-muted-foreground shrink-0'>Alt phone</span>
                  <a href={`tel:${secondaryPhone}`} className='font-mono text-xs hover:underline'>
                    {secondaryPhone}
                  </a>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className='text-sm'>Return</CardTitle></CardHeader>
            <CardContent className='space-y-2 text-sm'>
              <div className='flex justify-between gap-2'><span className='text-muted-foreground shrink-0'>Reason</span><span className='truncate'>{ret.reason || '—'}</span></div>
              <div className='flex justify-between gap-2'><span className='text-muted-foreground shrink-0'>Courier</span><span className='capitalize truncate'>{ret.courier || '—'}</span></div>
              <div className='flex justify-between gap-2'><span className='text-muted-foreground shrink-0'>Courier return ID</span><span className='font-mono text-xs truncate'>{ret.courierReturnId || '—'}</span></div>
              <div className='flex justify-between gap-2'><span className='text-muted-foreground shrink-0'>Courier status</span><span className='font-mono text-xs truncate'>{ret.courierStatus || '—'}</span></div>
              <div className='flex justify-between gap-2'><span className='text-muted-foreground shrink-0'>Original order</span>
                {ret.order ? (
                  <Link to='/op/orders/$id' params={{ id: ret.order.id }} className='font-mono text-xs text-primary hover:underline'>{ret.order.displayId}</Link>
                ) : <span className='font-mono text-xs truncate'>{ret.orderId.slice(0, 8)}</span>}
              </div>
              <div className='flex justify-between gap-2'><span className='text-muted-foreground shrink-0'>Exchange order</span>
                {ret.exchangeOrder ? (
                  <Link to='/op/exchanges/$id' params={{ id: ret.exchangeOrder.id }} className='font-mono text-xs text-primary hover:underline'>{ret.exchangeOrder.displayId}</Link>
                ) : <span className='text-xs text-muted-foreground'>—</span>}
              </div>
              <div className='flex justify-between gap-2'><span className='text-muted-foreground shrink-0'>Refund</span>
                {ret.refundId ? (
                  <a href={paymentDeepLink} className='font-mono text-xs text-primary hover:underline truncate'>{ret.refundId.slice(0, 8)} · payment list</a>
                ) : (
                  <a href={paymentDeepLink} className='text-xs text-primary hover:underline'>Refund from payment list</a>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className='text-sm'>Line items ({orderLines.length} order lines)</CardTitle></CardHeader>
          <CardContent className='space-y-1 text-sm'>
            {coverage.unknown && retRows.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                Quantities unknown — the courier never reports the split. Confirm exact quantities at mark-received.
              </p>
            ) : (
              <>
                {orderLines.map((line, i) => {
                  const key = `${line.productId}::${line.variantId ?? ''}`
                  const returned = returnedByKey.get(key) ?? 0
                  const orderedQty = Number(line.quantity ?? 0)
                  const unitPrice = Number(line.price ?? 0)
                  const img = resolveOrderItemImages(line.product, line.variant).image
                  const name = line.product?.name ?? '—'
                  const sku = line.variant?.sku || line.product?.sku || ''
                  return (
                    <div key={key || i} className='flex items-center gap-3 py-1.5'>
                      <SafeImage src={img} alt={name} className='h-10 w-10 rounded border object-cover shrink-0' />
                      <div className='min-w-0 flex-1'>
                        <p className='truncate font-medium'>{name}</p>
                        <p className='text-xs text-muted-foreground truncate'>
                          {variantLabel(line.variant)}
                          {sku ? <span className='font-mono'> · {sku}</span> : null}
                        </p>
                      </div>
                      <div className='text-right text-xs shrink-0'>
                        <div>
                          <span className='font-medium'>× {returned}</span>
                          {orderedQty > 0 ? <span className='text-muted-foreground'> of {orderedQty}</span> : null}
                        </div>
                        <div className='text-muted-foreground'>
                          {returned > 0
                            ? `${fmt(returned)} × ৳${fmt(unitPrice)} = ৳${fmt(returned * unitPrice)}`
                            : `returned 0 of ${orderedQty}`}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {orphanRows.map((l, i) => (
                  <div key={`orphan-${i}`} className='flex items-center justify-between py-1.5'>
                    <span className='font-mono text-xs truncate'>{String(l.productId).slice(0, 8)}</span>
                    <span className='text-xs'>× {Number(l.quantity ?? 0)}</span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

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
