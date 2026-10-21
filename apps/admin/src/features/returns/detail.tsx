import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  returnsApi,
  type ReturnDetail,
  type ReturnLineItem,
  type ReturnOrderItem,
} from './api'
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

/** Red contradiction warnings — the owner's real accident must catch the eye. */
const contradictionFor = (type: string, c: Coverage): string | null => {
  if (c.unknown || c.y <= 0) return null
  if (type === 'PARTIAL' && c.x > 0 && c.x >= c.y)
    return `PARTIAL return covers ALL ${c.y} ordered items — verify this is not a FULL-return mistake.`
  if (type === 'FULL' && c.x < c.y)
    return `FULL return covers only ${c.x} of ${c.y} — some ordered items are missing.`
  return null
}

interface ReceiveLine {
  key: string
  productId: string
  variantId: string | null
  name: string
  sku: string
  variant: ReturnOrderItem['variant']
  image: string | null
  orderedQty: number
  returnedQty: number
  quantity: number
  maxQuantity: number
  damagedQuantity: number
  unitPrice: number
  quantityEditable: boolean
}

const lineKey = (productId: string, variantId?: string | null) =>
  `${productId}::${variantId ?? ''}`

/**
 * Merge the courier return lines with the original order snapshot. Courier
 * rows with no split (items = []) fall back to the order lines and become
 * staff-editable; confirmed splits keep their quantity fixed and only allow
 * damage marking at receive.
 */
function buildReceiveLines(
  ret: ReturnDetail,
  draft: Record<string, { quantity: number; damagedQuantity: number }>,
): ReceiveLine[] {
  const retRows = ret.items ?? []
  const orderLines = ret.order?.items ?? []
  const confirmed = retRows.length > 0
  const orderByKey = new Map(
    orderLines.map((l) => [lineKey(l.productId, l.variantId), l]),
  )
  const returnedByKey = new Map(
    retRows.map((l) => [lineKey(l.productId, l.variantId), l]),
  )
  const source: Array<{
    productId: string
    variantId: string | null
    quantity: number
    damagedQuantity: number
    orderLine?: ReturnOrderItem
  }> = confirmed
    ? [
        ...orderLines.map((l) => {
          const returned = returnedByKey.get(lineKey(l.productId, l.variantId))
          return {
            productId: l.productId,
            variantId: l.variantId ?? null,
            quantity: Number(returned?.quantity ?? 0),
            damagedQuantity: Number(returned?.damagedQuantity ?? 0),
            orderLine: l,
          }
        }),
        ...retRows
          .filter((l) => !orderByKey.has(lineKey(l.productId, l.variantId)))
          .map((l) => ({
            productId: l.productId,
            variantId: l.variantId ?? null,
            quantity: Number(l.quantity ?? 0),
            damagedQuantity: Number(l.damagedQuantity ?? 0),
            orderLine: undefined,
          })),
      ]
    : orderLines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId ?? null,
        quantity: Number(l.quantity ?? 0),
        damagedQuantity: 0,
        orderLine: l,
      }))

  return source
    .map((row) => {
      const key = lineKey(row.productId, row.variantId)
      const maxQuantity = Math.max(0, row.quantity)
      const patched = draft[key]
      const quantity = Math.max(
        0,
        Math.min(maxQuantity, Math.floor(Number(patched?.quantity ?? row.quantity) || 0)),
      )
      const damagedQuantity = Math.max(
        0,
        Math.min(quantity, Math.floor(Number(patched?.damagedQuantity ?? row.damagedQuantity) || 0)),
      )
      const ol = row.orderLine
      return {
        key,
        productId: row.productId,
        variantId: row.variantId,
        name: ol?.product?.name ?? `Product ${row.productId.slice(0, 8)}`,
        sku: ol?.variant?.sku || ol?.product?.sku || '',
        variant: ol?.variant ?? null,
        image: ol ? resolveOrderItemImages(ol.product, ol.variant).image : null,
        orderedQty: Number(ol?.quantity ?? 0),
        returnedQty: row.quantity,
        quantity,
        maxQuantity,
        damagedQuantity,
        unitPrice: Number(ol?.price ?? 0),
        quantityEditable: !confirmed,
      }
    })
    .filter((l) => l.orderedQty > 0 || l.returnedQty > 0)
}

/** Only send a body when staff changed something meaningful; a plain
 *  confirmed receive keeps the historical empty-body contract. */
function buildReceiveItems(
  ret: ReturnDetail,
  draft: Record<string, { quantity: number; damagedQuantity: number }>,
): ReturnLineItem[] | undefined {
  const lines = buildReceiveLines(ret, draft)
  if (lines.length === 0) return undefined
  const confirmed = (ret.items ?? []).length > 0
  const touched = !confirmed || lines.some((l) => l.damagedQuantity > 0)
  if (!touched) return undefined
  return lines
    // Only RETURNING lines may be received: a line the customer kept has no
    // return quantity, so it can never reach the receive payload.
    .filter((l) => l.returnedQty > 0 && l.quantity > 0)
    .map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.quantity,
      damagedQuantity: l.damagedQuantity,
    }))
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
  /** operator-confirmed receive quantities/damage, keyed product::variant */
  const [receiveDraft, setReceiveDraft] = useState<Record<string, { quantity: number; damagedQuantity: number }>>({})
  /** "Mark as damaged after receive" quantities, keyed product::variant */
  const [damageDraft, setDamageDraft] = useState<Record<string, number>>({})

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
    mutationFn: () =>
      returnsApi.markReceived(
        id,
        ret ? buildReceiveItems(ret, receiveDraft) : undefined,
      ),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['return', id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      setReceiveDraft({})
      toast.success(`Return ${updated?.displayId ?? ''} marked received — good units restored, damaged units excluded.`)
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const markDamagedMut = useMutation({
    mutationFn: (items: { productId: string; variantId?: string | null; quantity: number }[]) =>
      returnsApi.markDamaged(id, items),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['return', id] })
      queryClient.invalidateQueries({ queryKey: ['returns'] })
      setDamageDraft({})
      toast.success(`Damage recorded on ${updated?.displayId ?? 'this return'} — sellable stock reduced.`)
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
  const receiveLines = buildReceiveLines(ret, receiveDraft)
  // What is actually coming back vs what the customer kept. A line belongs to
  // the return only when the return itself carries a quantity for it.
  const returningLines = receiveLines.filter((l) => l.returnedQty > 0)
  const keptLines = receiveLines.filter((l) => l.returnedQty === 0)
  const returningUnits = returningLines.reduce((n, l) => n + l.quantity, 0)
  const keptUnits = keptLines.reduce((n, l) => n + l.orderedQty, 0)
  const returnValue = returningLines.reduce(
    (n, l) => n + l.quantity * l.unitPrice,
    0,
  )
  const restocked = ret.stockReconciled || ret.status === 'RESTOCKED'
  const totalDamaged = retRows.reduce(
    (sum, l) => sum + Number(l.damagedQuantity ?? 0),
    0,
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
          {totalDamaged > 0 ? (
            <Badge variant='outline' className='border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'>
              {totalDamaged} damaged · not restocked
            </Badge>
          ) : null}
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
            <p className='text-base font-semibold leading-snug'>
              {`This return covers ${coverage.x} of ${coverage.y} items from ${snapshot?.displayId ?? 'the original order'}`}
            </p>
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
          <CardHeader>
            <CardTitle className='text-sm'>Items in this return ({returningUnits})</CardTitle>
          </CardHeader>
          <CardContent className='space-y-1 text-sm'>
            {receiveLines.length === 0 ? (
              <p className='text-xs text-muted-foreground'>
                Quantities unknown — the courier never reports the split and the order has no line snapshot. Confirm quantities from the order before receiving.
              </p>
            ) : (
              <>
                {returningLines.map((line) => {
                  const retRow = retRows.find(
                    (l) => lineKey(l.productId, l.variantId) === line.key,
                  )
                  const good = Math.max(0, line.quantity - line.damagedQuantity)
                  const remainingGood = Math.max(
                    0,
                    line.returnedQty - Number(retRow?.damagedQuantity ?? line.damagedQuantity ?? 0),
                  )
                  const damageNow = Math.max(
                    1,
                    Math.min(
                      remainingGood || 1,
                      Math.floor(Number(damageDraft[line.key] ?? 1) || 1),
                    ),
                  )
                  return (
                    <div key={line.key} className='flex items-start gap-3 py-2'>
                      <SafeImage src={line.image} alt={line.name} className='h-10 w-10 rounded border object-cover shrink-0' />
                      <div className='min-w-0 flex-1'>
                        <p className='truncate font-medium'>{line.name}</p>
                        <p className='text-xs text-muted-foreground truncate'>
                          {variantLabel(line.variant)}
                          {line.sku ? <span className='font-mono'> · {line.sku}</span> : null}
                        </p>
                        {retRow?.damageLog?.length ? (
                          <p className='mt-0.5 text-[10px] text-muted-foreground'>
                            Damage: {retRow.damageLog.map((d) => `${d.phase === 'receive' ? 'receive' : 'later'} +${d.qty}`).join(' · ')}
                          </p>
                        ) : null}
                      </div>
                      <div className='shrink-0 text-right text-xs space-y-1'>
                        <div>
                          {line.quantityEditable ? (
                            <>
                              <label htmlFor={`recv-${line.key}`} className='text-[10px] text-muted-foreground me-1'>Received</label>
                              <input
                                id={`recv-${line.key}`}
                                type='number'
                                min={0}
                                max={line.maxQuantity}
                                value={line.quantity}
                                aria-label={`Received quantity for ${line.name}`}
                                onChange={(e) => {
                                  const q = Math.max(0, Math.min(line.maxQuantity, Math.floor(Number(e.target.value) || 0)))
                                  setReceiveDraft((d) => {
                                    const cur = d[line.key] ?? { quantity: line.quantity, damagedQuantity: line.damagedQuantity }
                                    return { ...d, [line.key]: { quantity: q, damagedQuantity: Math.min(cur.damagedQuantity, q) } }
                                  })
                                }}
                                className='h-7 w-16 rounded border border-border/70 bg-card px-1 text-right tabular-nums'
                              />
                            </>
                          ) : (
                            <span className='font-medium'>× {line.quantity}</span>
                          )}
                          {line.orderedQty > 0 ? <span className='text-muted-foreground'> of {line.orderedQty}</span> : null}
                        </div>
                        <div className='flex items-center justify-end gap-1'>
                          <label htmlFor={`dmg-${line.key}`} className='text-[10px] text-muted-foreground'>Damaged</label>
                          <input
                            id={`dmg-${line.key}`}
                            type='number'
                            min={0}
                            max={line.quantity}
                            value={line.damagedQuantity}
                            aria-label={`Damaged quantity for ${line.name}`}
                            onChange={(e) => {
                              const q = Math.max(0, Math.min(line.quantity, Math.floor(Number(e.target.value) || 0)))
                              setReceiveDraft((d) => {
                                const cur = d[line.key] ?? { quantity: line.quantity, damagedQuantity: line.damagedQuantity }
                                return { ...d, [line.key]: { ...cur, damagedQuantity: q } }
                              })
                            }}
                            className='h-7 w-16 rounded border border-border/70 bg-card px-1 text-right tabular-nums'
                          />
                        </div>
                        <div className='text-muted-foreground'>
                          {`${fmt(line.quantity)} × ৳${fmt(line.unitPrice)} = ৳${fmt(line.quantity * line.unitPrice)}`}
                        </div>
                        {restocked ? (
                          <p className='text-[11px] text-muted-foreground tabular-nums'>
                            {fmt(good)} restored · {fmt(line.damagedQuantity)} damaged (not restocked)
                          </p>
                        ) : line.damagedQuantity > 0 ? (
                          <p className='text-[11px] text-amber-700 dark:text-amber-400 tabular-nums'>
                            {fmt(line.damagedQuantity)} damaged — will not be restocked
                          </p>
                        ) : null}
                        {restocked && remainingGood > 0 ? (
                          <div className='flex items-center justify-end gap-1 pt-0.5'>
                            <input
                              type='number'
                              min={1}
                              max={remainingGood}
                              value={damageNow}
                              aria-label={`Damage now for ${line.name}`}
                              onChange={(e) => {
                                const q = Math.max(1, Math.min(remainingGood, Math.floor(Number(e.target.value) || 1)))
                                setDamageDraft((d) => ({ ...d, [line.key]: q }))
                              }}
                              className='h-7 w-14 rounded border border-border/70 bg-card px-1 text-right tabular-nums'
                            />
                            <Button
                              size='sm'
                              variant='outline'
                              className='h-7 px-2 text-[11px]'
                              disabled={markDamagedMut.isPending}
                              onClick={() =>
                                markDamagedMut.mutate([
                                  {
                                    productId: line.productId,
                                    variantId: line.variantId,
                                    quantity: damageNow,
                                  },
                                ])
                              }
                            >
                              Mark as damaged
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
                {retRows
                  .filter((l) => !receiveLines.some((r) => r.key === lineKey(l.productId, l.variantId)))
                  .map((l, i) => (
                    <div key={`orphan-${i}`} className='flex items-center justify-between py-1.5'>
                      <span className='font-mono text-xs truncate'>{String(l.productId).slice(0, 8)}</span>
                      <span className='text-xs'>× {Number(l.quantity ?? 0)}</span>
                    </div>
                  ))}
              </>
            )}
            {returningLines.length > 0 ? (
              <div className='flex items-center justify-between border-t pt-2 mt-2 font-semibold'>
                <span>Return value</span>
                <span className='tabular-nums'>{`৳${fmt(returnValue)}`}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* What the customer is NOT sending back — demoted, no inputs, no money. */}
        {keptLines.length > 0 ? (
          <Card className='bg-muted/30'>
            <CardHeader>
              <CardTitle className='text-sm text-muted-foreground'>
                {`Not in this return — kept by customer (${keptUnits})`}
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-1 text-sm text-muted-foreground'>
              {keptLines.map((line) => (
                <div key={line.key} className='flex items-center gap-3 py-1.5'>
                  <SafeImage
                    src={line.image}
                    alt={line.name}
                    className='h-8 w-8 rounded border object-cover shrink-0 opacity-70'
                  />
                  <div className='min-w-0 flex-1'>
                    <p className='truncate'>{line.name}</p>
                    <p className='text-xs truncate'>
                      {variantLabel(line.variant)}
                      {line.sku ? <span className='font-mono'> · {line.sku}</span> : null}
                    </p>
                  </div>
                  <span className='shrink-0 text-xs tabular-nums whitespace-nowrap'>
                    {`Ordered ×${line.orderedQty}`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <div className='flex flex-wrap gap-2'>
          <Button size='sm' variant='outline' onClick={checkStatus} disabled={checking || !order?.courierConsignmentId}>
            {checking ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' /> : null}
            Check return status
          </Button>
          <Button size='sm' onClick={() => markMut.mutate()} disabled={markMut.isPending || restocked || ret.status === 'CLOSED'}>
            {markMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' /> : null}
            Mark received
          </Button>
        </div>
      </Main>
    </>
  )
}
