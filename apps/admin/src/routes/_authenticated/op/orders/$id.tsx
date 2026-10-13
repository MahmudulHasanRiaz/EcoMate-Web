import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SafeImage } from '@/components/safe-image'
import { CustomerContactActions } from '@/components/customer-contact-actions'
import { CopyButton } from '@/components/copy-button'
import { BlockPhoneDialog } from '@/features/orders/block-phone-dialog'
import { CanonicalAttributionBadges } from '@/features/orders/canonical-attribution-badge'
import { OthersInfoDialog } from '@/features/orders/others-info-dialog'
import { useAuthStore } from '@/stores/auth-store'
import { UserBadge } from '@/components/user-badge'
import { ordersApi, rtnApi, mediaUrl } from '@/features/orders/api'
import { ReturnOrderDialog } from '@/features/orders/components/return-order-dialog'

import { CourierCustomerHistoryCard } from '@/features/orders/courier-customer-history-card'
import { CodMismatchBanner } from '@/features/orders/components/cod-mismatch-banner'
import { PaymentLedgerCard } from '@/features/orders/components/payment-ledger-card'
import { RecordPaymentModal } from '@/features/orders/components/record-payment-modal'
import { RecordRefundModal } from '@/features/orders/components/record-refund-modal'
import { OrderSummaryCard } from '@/features/orders/order-summary-card'
import { OrderEditLockGuard } from '@/features/orders/order-edit-lock'
import { OrderSourceBadges } from '@/features/orders/order-source-badge'
import { CustomerEditSheet } from '@/features/orders/customer-edit-sheet'
import { apiClient } from '@/lib/api-client'
import { variantLabel, variantThumbUrl } from '@/lib/product-variant'
import { resolveOrderItemImages } from '@/lib/product-image'
import { byExactMatchFirst } from '@/lib/search-products'
import {
  getCustomerDisplayName,
  getCustomerPhone,
  getCustomerEmail,
  getOrderPaidAmount,
  getOrderDueAmount,
  getOrderPaymentMode,
} from '@/lib/order-display'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Separator } from '@/components/ui/separator'
import {
  Loader2, ArrowLeft, ArrowRight, Package, Pencil, Save, Clock, User, ChevronDown, ChevronUp,
  Truck, ExternalLink, Printer, Eye, EyeOff, MessageSquarePlus, ArrowRightLeft, Tag, Send,
  AlertTriangle, MoreHorizontal, Minus, Plus, X, MapPin, Mail, Phone, Trash2, RefreshCcw, Ban, Lock,
  RotateCcw, ScanSearch, Calendar, CreditCard, CheckCircle2, ShoppingBag, History
} from 'lucide-react'
import { DISPATCH_STATUSES } from '@/features/dispatch/data/data'
import { STATUS_COLORS as statusColors } from '@/features/orders/status-transitions'

const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

// Pull the HUMAN-readable reason out of an axios/unknown error. Backend guards
// throw spotted objects ({message}) or plain strings; axios wraps these in
// e.response.data. Never fall back to the generic "Request failed" text.
const errMsg = (e: unknown): string => {
  const err = e as any
  const d = err?.response?.data
  const msg = d?.message ?? d?.error ?? err?.message
  if (typeof msg === 'string' && msg.trim()) return msg.trim()
  if (Array.isArray(msg)) return msg.join(', ')
  if (typeof d === 'string' && d.trim()) return d.trim()
  return 'Update failed. Please try again.'
}

const ep = (p: any) => {
  if (p.type === 'variable' && p.variants?.length) {
    return Math.min(...p.variants.map((v: any) => nn(v.salePrice ?? v.price ?? 0)))
  }
  return nn(p.salePrice ?? p.basePrice ?? 0)
}

function paymentOptionTypeLabel(type: string): string {
  const map: Record<string, string> = { FULL_PAYMENT: 'Full Payment', PARTIAL_PAYMENT: 'Partial Payment', CASH_ON_DELIVERY: 'Cash on Delivery' }
  return map[type] || type?.replace(/_/g, ' ') || '—'
}

const paymentStatusColors: Record<string, string> = {
  PAYMENT_PENDING: '#F59E0B', PENDING: '#F59E0B', PAID: '#22C55E',
  PARTIAL_PAID: '#3B82F6', UNPAID: '#EF4444', FAILED: '#DC2626',
  CANCELLED: '#6B7280', REFUNDED: '#EC4899',
  // Derived ledger modes (getOrderPaymentMode) — the badge source of truth.
  Unpaid: '#EF4444', Partial: '#3B82F6', Paid: '#22C55E', Credit: '#8B5CF6',
  Refunded: '#EC4899',
}

function PaymentStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null
  const color = paymentStatusColors[status] || '#6B7280'
  return <Badge style={{ backgroundColor: color, color: '#fff' }} className='text-xs'>{status.replace(/_/g, ' ')}</Badge>
}

export const Route = createFileRoute('/_authenticated/op/orders/$id')({ component: OrderDetailPage })

function OrderDetailPage() {
  const queryClient = useQueryClient()
  const { id } = Route.useParams() as { id: string }

  // A live edit lock held by ANOTHER staff member makes the backend return
  // 409 ORDER_LOCKED on GET /orders/:id. We surface the holder here and offer
  // the override — after override the query refetches successfully.
  const [showOthersInfo, setShowOthersInfo] = useState(false)

  // Others Information exposes IP, User-Agent, tracking identifiers and customer
  // PII — fraud-review grade data, not day-to-day order operations. Managers are
  // excluded here and the API enforces the same rule independently.
  const othersInfoRoles = new Set(['superadmin', 'admin'])
  const role = useAuthStore((s) => s.auth.user?.role)
  const canViewOthersInfo = !!role && othersInfoRoles.has(role)

  const [viewLock, setViewLock] = useState<{ userName?: string | null; acquiredAt?: string | null } | null>(null)
  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      try {
        setViewLock(null)
        return (await ordersApi.get(id)).data
      } catch (e: any) {
        if (e?.response?.status === 409 && e?.response?.data?.code === 'ORDER_LOCKED') {
          setViewLock(e?.response?.data?.lock ?? { userName: null })
        }
        throw e
      }
    },
    retry: false,
  })

  const { data: statuses } = useQuery({ queryKey: ['order-statuses'], queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]) })
  const statusList = (Array.isArray(statuses) ? statuses : []) as any[]

  // ── Items edit state ──────────────────────────────────────────────
  const [editingItems, setEditingItems] = useState(false)
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [productSearchResults, setProductSearchResults] = useState<any[]>([])
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any>(null)

  // ── Customer sheet state ──────────────────────────────────────────
  const [showCustomerSheet, setShowCustomerSheet] = useState(false)
  const [showPastOrdersDialog, setShowPastOrdersDialog] = useState(false)

  // ── Payment edit state (mirrors the create-page payment card) ──
  const [editingPayment, setEditingPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentMode, setPaymentMode] = useState<'cod' | 'full' | 'partial'>('cod')
  const [partialAmount, setPartialAmount] = useState('')

  // ── Ledger modals (Task 11: append-only entries, never in-place edits) ──
  const [showRecordPayment, setShowRecordPayment] = useState(false)
  const [showRecordRefund, setShowRecordRefund] = useState(false)

  // ── Timeline / Notes ─────────────────────────────────────────────
  const [noteText, setNoteText] = useState('')
  const [noteVisibility, setNoteVisibility] = useState<'public' | 'private'>('public')
  const [showStatusDialog, setShowStatusDialog] = useState<string | null>(null)
  const [blockPhones, setBlockPhones] = useState<{ phones: string[]; contextLabel?: string } | null>(null)
  const [statusNote, setStatusNote] = useState('')

  // ── Collapsible sidebar panels ────────────────────────────────────


  // ── Dispatch ─────────────────────────────────────────────────────
  const [showDispatchDialog, setShowDispatchDialog] = useState(false)
  const [dispatchCourier, setDispatchCourier] = useState('')

  // ── RTN (return order) ─────────────────────────────────────────────
  const { data: rtnOrder } = useQuery({
    queryKey: ['rtn-for-order', id],
    queryFn: () => rtnApi.forOrder(id),
    enabled: !!order && order.kind !== 'RETURN',
  })
  const [showRtnDialog, setShowRtnDialog] = useState(false)
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})

  // ── Queries ───────────────────────────────────────────────────────
  const { data: courierCreds } = useQuery({ queryKey: ['courier-creds'], queryFn: () => apiClient.get('/couriers/credentials').then(r => r.data as any[]), enabled: showDispatchDialog })
  const activeCouriers = (Array.isArray(courierCreds) ? courierCreds : []).filter((c: any) => c.enabled)

  const { data: shippingOptions } = useQuery({
    queryKey: ['shipping-options'],
    queryFn: () => apiClient.get('/shipping/options').then(r => (r.data as any[]).filter((o: any) => o.isActive)),
  })

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiClient.get('/system-settings').then(r => r.data),
  })

  const shippingMode = sysSettings?.['shipping_mode'] || 'auto_district'

  // S1/S2 (live in the same /system-settings map): S1 ON (default) means staff
  // entries skip verification, so txn ID is optional; S2 OFF (default) means
  // no edit UI for recorded payments — corrections go through new entries.
  const staffAutoVerified = sysSettings?.['payments.staffAutoVerified'] !== 'false'
  const paymentEditAllowed = sysSettings?.['payments.editAllowed'] === 'true'

  const phone = order?.customer?.phoneNumber?.replace(/[^\d]/g, '')
  const { data: customerSummary } = useQuery({ queryKey: ['customer-summary', phone], queryFn: () => apiClient.get(`/customers/order-summary?phone=${phone}`).then(r => r.data), enabled: !!phone })


  // ── Effects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (order) setOrderItems(order.items || [])
  }, [order])

  // Product search hits the backend so ANY product (not just the first page) is
  // findable by name, product SKU, or variant SKU. Exact SKU/name matches are
  // re-sorted to the top so they never hide behind partial matches.
  useEffect(() => {
    const q = productSearchQuery.trim()
    if (!q || !editingItems) { setProductSearchResults([]); return }
    const t = setTimeout(() => {
      apiClient.get('/products', { params: { search: q, perPage: 50 } })
        .then(r => setProductSearchResults(byExactMatchFirst<any>(r.data?.data || r.data || [], q)))
        .catch(() => setProductSearchResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [productSearchQuery, editingItems])

  // ── Mutations ─────────────────────────────────────────────────────
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.updateOrder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      toast.success('Updated')
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, statusId, note }: { id: string; statusId: string; note?: string }) => ordersApi.updateStatus(id, statusId, note),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['order', id] }); toast.success('Status updated') },
    onError: (e: unknown) => {
      const msg = errMsg(e)
      // Cancel blocked by outstanding paid balance (D5): surface the backend
      // message and deep-link straight into the refund flow (cancel-too can
      // cancel atomically once the balance is refunded).
      if (/আগে রিফান্ড/.test(msg)) {
        toast.error(msg, { duration: 9000 })
        setShowStatusDialog(null)
        setStatusNote('')
        setShowRecordRefund(true)
        return
      }
      toast.error(msg)
    },
  })

  const noteMut = useMutation({
    mutationFn: ({ id, note, visibility }: { id: string; note: string; visibility: 'public' | 'private' }) => ordersApi.addNote(id, note, visibility),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['order', id] }); toast.success('Note added') },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const dispatchMut = useMutation({
    mutationFn: ({ courier, orderId }: { courier: string; orderId: string }) => apiClient.post(`/couriers/dispatch/${courier}`, { orderIds: [orderId] }),
    onSuccess: (res) => {
      const results = (res as any)?.data as any[] || []
      const succeeded = results.filter((r: any) => r.ok)
      const failed = results.filter((r: any) => !r.ok)
      if (failed.length > 0) toast.error(failed[0]?.message || 'Dispatch failed')
      if (succeeded.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['order', id] })
        setShowDispatchDialog(false); setDispatchCourier('')
        toast.success('Order dispatched')
      }
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const trashMut = useMutation({
    mutationFn: (orderId: string) => ordersApi.trash(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Order moved to trash')
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  const restoreMut = useMutation({
    mutationFn: (orderId: string) => ordersApi.restore(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Order restored from trash')
    },
    onError: (e: unknown) => toast.error(errMsg(e)),
  })

  // ── Handlers ──────────────────────────────────────────────────────
  function openPaymentEdit() {
    if (!order) return
    const mode: 'cod' | 'full' | 'partial' =
      order.paymentOptionType === 'CASH_ON_DELIVERY' ? 'cod'
      : order.paymentOptionType === 'PARTIAL_PAYMENT' ? 'partial'
      : 'full'
    setPaymentMode(mode)
    setPaymentMethod((order.payments?.[0]?.gatewayCode) || 'cash')
    setPartialAmount(order.partialAmount ? String(order.partialAmount) : '')
    setEditingPayment(true)
  }

  async function handleSavePayment() {
    if (paymentMode === 'partial' && (!partialAmount || parseFloat(partialAmount) <= 0)) {
      toast.error('Enter a partial amount greater than 0')
      return
    }
    // Collected money is a fact: mirror the backend floor so staff learn it
    // before the server 400s (refund guidance included in both messages).
    const collected = (order?.payments || [])
      .filter((p: any) => p.status === 'PAID')
      .reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
    if (paymentMode === 'partial' && partialAmount && parseFloat(partialAmount) < collected) {
      toast.error(`৳${collected} is already collected — record a refund to lower the advance below it.`)
      return
    }
    try {
      await updateMut.mutateAsync({
        id,
        data: {
          paymentOptionType: paymentMode === 'cod' ? 'CASH_ON_DELIVERY' : paymentMode === 'full' ? 'FULL_PAYMENT' : 'PARTIAL_PAYMENT',
          gatewayCode: paymentMethod || undefined,
          partialAmount: paymentMode === 'partial' && partialAmount ? parseFloat(partialAmount) : undefined,
        },
      })
      setEditingPayment(false)
    } catch {
      // onError toast surfaces the backend reason; keep the editor open.
    }
  }

  async function handleSaveItems() {
    try {
      await updateMut.mutateAsync({
        id,
        data: {
          items: orderItems.map((i: any) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
            price: Number(i.price),
          })),
        },
      })
      // Only exit the inline editor when the save succeeded — on failure the
      // rows stay visible so the user sees WHY (stock/sku errors) and can fix.
      setEditingItems(false)
    } catch {
      // onError toast already surfaced the backend reason; keep editor open.
    }
  }

  function handleSaveShipping(charge: number, optionId?: string) {
    updateMut.mutate({
      id,
      data: {
        shippingCharge: charge,
        selectedShippingOptionId: optionId || null,
      },
    })
  }

  function handleSaveDiscount(amount: number, type: 'flat' | 'percentage') {
    updateMut.mutate({ id, data: { discount: amount, discountType: type } })
  }

  // Analytics fulfillment-cost capture (P2 §3.4): staff-entered actual cost.
  function handleSaveFulfillmentCost(cost: number) {
    updateMut.mutate({
      id,
      data: { shippingCost: cost, shippingCostSource: 'manual' },
    })
  }

  function handleSaveCustomer(data: {
    firstName: string; lastName: string; email: string; phone: string
    address: string; cityId: string; zoneId: string; customerNotes: string; officeNotes: string
  }) {
    updateMut.mutate({
      id,
      data: {
        customerInfo: { firstName: data.firstName, lastName: data.lastName, email: data.email, phoneNumber: data.phone },
        shippingAddress: { address: data.address, cityId: data.cityId, zoneId: data.zoneId },
        customerNotes: data.customerNotes || null,
        officeNotes: data.officeNotes || null,
      },
    })
    setShowCustomerSheet(false)
  }

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>

  // Another staff member holds a live edit lock — view is blocked until the
  // viewer explicitly overrides (recorded in the order timeline).
  if (!order && viewLock) {
    return (
      <TooltipProvider>
        <>
          <Header fixed>
            <Link to='/op/orders' className='me-auto'>
              <Button variant='ghost'><ArrowLeft className='h-4 w-4 mr-1' /> Back</Button>
            </Link>
            <ThemeSwitch />
            <ProfileDropdown />
          </Header>
          <Main className='flex flex-1 items-center justify-center'>
            <div className='max-w-md w-full rounded-xl border border-amber-500/25 bg-amber-500/5 p-8 text-center'>
              <Lock className='h-10 w-10 mx-auto mb-4 text-amber-500' />
              <h2 className='text-lg font-bold mb-2'>Order is being edited</h2>
              <p className='text-sm text-muted-foreground mb-6'>
                <strong>{viewLock.userName || 'Another staff member'}</strong> is currently editing this order.
                You can open it in read-only mode by taking over the edit lock — the takeover is recorded in the order history.
              </p>
              <div className='flex justify-center gap-3'>
                <Button variant='outline' onClick={() => window.history.back()}>Go back</Button>
                <Button
                  onClick={async () => {
                    try {
                      await apiClient.post(`/orders/${id}/lock/override`)
                      toast.success('Lock overridden — you are now editing')
                      queryClient.invalidateQueries({ queryKey: ['order', id] })
                    } catch (e: unknown) {
                      toast.error(errMsg(e))
                    }
                  }}
                >
                  <Lock className='h-4 w-4 mr-2' /> Override and open
                </Button>
              </div>
            </div>
          </Main>
        </>
      </TooltipProvider>
    )
  }

  if (!order) return <div className='p-6 text-muted-foreground'>Order not found</div>

  const allowedStatuses = ((order.status.nextStatuses as string[]) || []).map((sid: string) => statusList.find((s: any) => s.id === sid)).filter(Boolean)

  return (
    <TooltipProvider>
      <>
        <Header fixed>
          <Link to='/op/orders' className='me-auto'>
            <Button variant='ghost'><ArrowLeft className='h-4 w-4 mr-1' /> Back</Button>
          </Link>
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>

        <Main className='flex flex-1 flex-col gap-3.5 sm:gap-6 p-2.5 sm:p-6 pb-24 sm:pb-32 max-w-[1600px] w-full mx-auto'>

          <OrderEditLockGuard orderId={order.id} disabled={!!order.trashedAt} />

          {/* COD mismatch — server-driven, persistent while an open alert exists */}
          <CodMismatchBanner orderId={order.id} due={getOrderDueAmount(order)} dispatches={order.dispatches} />

          {/* ── Executive Order Header Banner ──────────────────────── */}
          <div className='rounded-2xl border border-border/70 bg-card/75 backdrop-blur-md p-3 sm:p-6 shadow-2xs space-y-3 sm:space-y-4'>
            {/* Top context & identification row */}
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-4'>
              <div className='flex items-center gap-2.5 flex-wrap'>
                <div className='flex items-center gap-2'>
                  <h1 className='text-xl sm:text-2xl lg:text-3xl font-bold font-mono tracking-tight text-foreground flex items-center gap-2'>
                    <span className='break-all sm:break-normal'>{order.displayId}</span>
                    <CopyButton text={order.displayId} label='Order ID' />
                  </h1>
                </div>

                <div className='flex items-center gap-1.5 flex-wrap'>
                  {/* Canonical attribution badges */}
                  <CanonicalAttributionBadges
                    channel={order.channel}
                    channelEntity={order.channelEntity}
                    sourceSlug={order.sourceSlug}
                    sourceLabel={order.sourcePlatformName}
                    acquisitionType={order.acquisitionType}
                  />
                  {!order.channel && !order.sourceSlug && !order.acquisitionType &&
                    (order.salesChannel || order.sourcePlatform || order.sourceType || order.sourceEntity) ? (
                      <OrderSourceBadges
                        attribution={{
                          salesChannel: order.salesChannel,
                          sourcePlatform: order.sourcePlatform,
                          sourceType: order.sourceType,
                          sourceEntity: order.sourceEntity,
                        }}
                        className='text-xs h-auto py-0.5'
                      />
                    ) : null}
                  {order.trashedAt && (
                    <Badge variant='destructive' className='text-xs gap-1 py-0.5'>
                      <Trash2 className='h-3 w-3' /> Trashed
                    </Badge>
                  )}
                  {order.kind === 'RETURN' && (
                    <Badge variant='outline' className='text-xs gap-1 border-pink-500/50 text-pink-500 bg-pink-500/10 py-0.5'>
                      <RotateCcw className='h-3 w-3' /> Return Order
                    </Badge>
                  )}
                </div>
              </div>

              <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                <Calendar className='h-3.5 w-3.5 text-muted-foreground/70 shrink-0' />
                <span>Placed on <strong className='text-foreground font-medium'>{new Date(order.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</strong> at {new Date(order.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            {order.trashedAt && (
              <div className='rounded-xl border border-destructive/30 bg-destructive/8 p-3.5 text-sm text-destructive flex items-center gap-2.5'>
                <AlertTriangle className='h-4 w-4 shrink-0' />
                <span>This order was moved to trash on {new Date(order.trashedAt).toLocaleString()} and is excluded from regular reports.</span>
              </div>
            )}

            {/* Status & Action Controls Toolbar */}
            <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between pt-0.5'>
              <div className='flex items-center gap-2 sm:gap-2.5 flex-wrap'>
                {/* Current Status Pill */}
                <div className='flex items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-2.5 sm:px-3 py-1.5 shadow-2xs flex-wrap'>
                  <span
                    className='h-2.5 w-2.5 rounded-full ring-2 ring-background shrink-0 animate-pulse'
                    style={{ backgroundColor: statusColors[order.status.name] || '#6B7280' }}
                  />
                  <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }} className='text-xs'>
                    {order.status.name}
                  </Badge>
                  {order.dispatches && order.dispatches.length > 0 && (() => {
                    const d = order.dispatches
                    const latestDispatch = d[d.length - 1]
                    const ds = DISPATCH_STATUSES.find(d => d.value === latestDispatch.status)
                    return (
                      <Badge variant='outline' className={`text-[11px] gap-1 px-2 py-0 border-border/60 ${ds?.color ? ds.color.replace('bg-', 'text-').replace('-500', '-600') : ''}`}>
                        <Truck className='h-3 w-3' />{ds?.label || latestDispatch.status}
                      </Badge>
                    )
                  })()}
                  {order.trackingUrl && (
                    <Button size='icon' variant='ghost' className='h-5.5 w-5.5 text-muted-foreground hover:text-foreground' title='Track shipment' onClick={() => window.open(order.trackingUrl!, '_blank')}>
                      <ExternalLink className='h-3 w-3' />
                    </Button>
                  )}
                </div>

                {/* Next Status Transitions */}
                {allowedStatuses.length > 0 && order.kind !== 'RETURN' && (
                  <>
                    <div className='sm:hidden'>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='outline' size='sm' className='h-8 text-xs gap-1 shadow-2xs'>
                            Change Status <ChevronDown className='h-3.5 w-3.5' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='start'>
                          {allowedStatuses.map((s: any) => (
                            <DropdownMenuItem key={s.id} onClick={() => setShowStatusDialog(s.id)}>
                              <span style={{ color: statusColors[s.name] || undefined }}>→ {s.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className='hidden sm:flex items-center gap-1.5'>
                      {allowedStatuses.slice(0, 3).map((s: any) => (
                        <Button
                          key={s.id}
                          variant='outline'
                          size='sm'
                          className='h-8 text-xs px-2.5 font-medium transition-all shadow-2xs hover:shadow-xs'
                          style={{ borderColor: `${statusColors[s.name] || '#6B7280'}60`, color: statusColors[s.name] || undefined }}
                          onClick={() => setShowStatusDialog(s.id)}
                        >
                          → {s.name}
                        </Button>
                      ))}
                      {allowedStatuses.length > 3 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant='outline' size='sm' className='h-8 text-xs px-2 shadow-2xs'>
                              +{allowedStatuses.length - 3} <ChevronDown className='h-3 w-3 ml-0.5' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            {allowedStatuses.slice(3).map((s: any) => (
                              <DropdownMenuItem key={s.id} onClick={() => setShowStatusDialog(s.id)}>
                                <span style={{ color: statusColors[s.name] || undefined }}>→ {s.name}</span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Primary & Secondary Action CTAs */}
              <div className='flex items-center gap-2 flex-wrap'>
                {!order.trashedAt && order.kind !== 'RETURN' && (
                  <Button variant='outline' size='sm' className='h-8 gap-1.5 text-xs font-medium' asChild>
                    <Link to='/op/orders/$id/edit' params={{ id }}>
                      <Pencil className='h-3.5 w-3.5' />
                      <span className='hidden sm:inline'>Edit Order</span>
                      <span className='sm:hidden'>Edit</span>
                    </Link>
                  </Button>
                )}

                {!order.courierService && order.kind !== 'RETURN' && (
                  <Button variant='default' size='sm' className='h-8 gap-1.5 shadow-xs font-medium' onClick={() => setShowDispatchDialog(true)}>
                    <Send className='h-3.5 w-3.5' />
                    <span className='hidden sm:inline'>Send to Courier</span>
                    <span className='sm:hidden'>Dispatch</span>
                  </Button>
                )}

                {order.status.name === 'Partial' && !rtnOrder && (
                  <Button
                    variant='default'
                    size='sm'
                    className='h-8 gap-1.5 shadow-xs bg-pink-600 hover:bg-pink-700 font-medium'
                    onClick={() => { setReturnQtys({}); setShowRtnDialog(true) }}
                  >
                    <RotateCcw className='h-3.5 w-3.5' />
                    <span className='hidden sm:inline'>Create Return Order</span>
                    <span className='sm:hidden'>Return Order</span>
                  </Button>
                )}

                {canViewOthersInfo && (
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-8 gap-1.5 text-xs font-medium'
                    onClick={() => setShowOthersInfo(true)}
                  >
                    <ScanSearch className='h-3.5 w-3.5' />
                    <span className='hidden sm:inline'>Others Information</span>
                    <span className='sm:hidden'>Others</span>
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' size='sm' className='h-8 px-2.5 shadow-2xs'>
                      <MoreHorizontal className='h-4 w-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    {!order.trashedAt && order.kind === 'SALE' && (
                      <DropdownMenuItem asChild>
                        <Link to='/op/orders/$id/exchange' params={{ id }}>
                          <ArrowRightLeft className='h-4 w-4 mr-2' /> Create Exchange Order
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => window.open(`/admin/op/print/sticker/${order.id}`, '_blank')}>
                      <Printer className='h-4 w-4 mr-2' /> Print Sticker
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.open(`/admin/op/print/invoice/${order.id}`, '_blank')}>
                      <Printer className='h-4 w-4 mr-2' /> Print Invoice
                    </DropdownMenuItem>
                    {!order.trashedAt ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className='text-destructive focus:text-destructive'
                          disabled={trashMut.isPending}
                          onClick={() => trashMut.mutate(order.id)}
                        >
                          <Trash2 className='h-4 w-4 mr-2' /> Move to Trash
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={restoreMut.isPending}
                          onClick={() => restoreMut.mutate(order.id)}
                        >
                          <RefreshCcw className='h-4 w-4 mr-2' /> Restore from Trash
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {/* ── Main Grid ────────────────────────────────────────── */}
          <div className='grid grid-cols-1 xl:grid-cols-12 gap-3.5 sm:gap-6 items-start'>

            {/* ════ LEFT COLUMN ════ */}
            <div className='xl:col-span-7 2xl:col-span-8 space-y-3.5 sm:space-y-6'>

              {/* Items Card */}
              <Card className='overflow-hidden border border-border/70 shadow-xs'>
                <CardHeader className='bg-muted/30 border-b border-border/50 py-2.5 px-3.5 sm:py-3.5 sm:px-6'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2.5'>
                      <div className='h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold'>
                        <Package className='h-4 w-4' />
                      </div>
                      <div>
                        <CardTitle className='text-sm font-semibold tracking-tight text-foreground flex items-center gap-2'>
                          Ordered Items
                          <Badge variant='secondary' className='text-[11px] font-medium px-2 py-0.5 rounded-full'>
                            {(editingItems ? orderItems : order.items)?.length || 0} {(editingItems ? orderItems : order.items)?.length === 1 ? 'item' : 'items'}
                          </Badge>
                        </CardTitle>
                        <p className='text-xs text-muted-foreground mt-0.5'>Review products, quantities, and pricing details</p>
                      </div>
                    </div>
                    {!editingItems ? (
                      <Button variant='outline' size='sm' className='h-8 text-xs font-medium shadow-none hover:bg-accent' onClick={() => setEditingItems(true)}>
                        <Pencil className='h-3.5 w-3.5 mr-1.5' />
                        <span className='hidden sm:inline'>Edit Items</span>
                        <span className='sm:hidden'>Edit</span>
                      </Button>
                    ) : (
                      <div className='flex gap-2'>
                        <Button variant='ghost' size='sm' className='h-8 text-xs font-medium' onClick={() => { setEditingItems(false); setOrderItems(order.items || []) }}>
                          <X className='h-3.5 w-3.5 mr-1.5' /> Cancel
                        </Button>
                        <Button size='sm' className='h-8 text-xs font-medium' onClick={handleSaveItems} disabled={updateMut.isPending}>
                          {updateMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1.5' /> : <Save className='h-3.5 w-3.5 mr-1.5' />}
                          <span className='hidden sm:inline'>Save Changes</span>
                          <span className='sm:hidden'>Save</span>
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className='p-0'>
                  {/* Desktop Table View */}
                  <div className='hidden md:block overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow className='bg-muted/15 border-b border-border/40 hover:bg-muted/15'>
                          <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10 px-4 sm:px-6'>Product & SKU</TableHead>
                          <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10 text-right w-28'>Unit Price</TableHead>
                          <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10 text-right w-28'>Quantity</TableHead>
                          <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10 text-right w-28 pr-4 sm:pr-6'>Line Total</TableHead>
                          {editingItems && <TableHead className='w-12 text-center' />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(editingItems ? orderItems : order.items)?.map((item: any, index: number) => {
                          const itemImages = resolveOrderItemImages(
                            item.product ?? item.variant?.product,
                            item.variant,
                          )
                          return (
                            <TableRow key={item.id || index} className='hover:bg-muted/30 transition-colors'>
                              <TableCell className='px-4 sm:px-6 py-3'>
                                <div className='flex items-center gap-3.5'>
                                  {itemImages.hasImage ? (
                                    <SafeImage
                                      src={mediaUrl(itemImages.image)}
                                      fallbackSrc={mediaUrl(itemImages.colorImage ?? itemImages.productImage)}
                                      alt=''
                                      className='h-11 w-11 rounded-lg border border-border/70 object-cover flex-shrink-0 bg-muted/40 shadow-xs'
                                      thumbWidth={48}
                                      thumbHeight={48}
                                    />
                                  ) : (
                                    <div className='h-11 w-11 rounded-lg border border-border/70 bg-muted/50 flex items-center justify-center flex-shrink-0 text-muted-foreground shadow-xs'>
                                      <Package className='h-5 w-5 opacity-70' />
                                    </div>
                                  )}
                                  <div className='min-w-0 flex-1 space-y-1'>
                                    <span className='text-sm font-medium text-foreground block leading-snug'>{item.product?.name}</span>
                                    <div className='flex flex-wrap items-center gap-1.5'>
                                      {item.variant && item.variant.attributeValues?.length > 0 && (
                                        <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border/40'>
                                          {item.variant.attributeValues.map((av: any) => av.attributeValue?.value).filter(Boolean).join(' / ')}
                                        </span>
                                      )}
                                      {item.variant?.sku ? (
                                        <span className='text-[11px] text-muted-foreground/75 font-mono inline-flex items-center gap-0.5'>
                                          SKU: <span className='font-semibold text-foreground/80'>{item.variant.sku}</span>
                                        </span>
                                      ) : item.product?.sku ? (
                                        <span className='text-[11px] text-muted-foreground/75 font-mono inline-flex items-center gap-0.5'>
                                          SKU: <span className='font-semibold text-foreground/80'>{item.product.sku}</span>
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className='text-right'>
                                {editingItems ? (
                                  <Input
                                    type='number'
                                    value={item.price}
                                    onChange={e => {
                                      const newItems = [...orderItems]
                                      newItems[index].price = parseFloat(e.target.value) || 0
                                      setOrderItems(newItems)
                                    }}
                                    className='w-24 text-right h-8 text-sm ml-auto font-medium'
                                  />
                                ) : (
                                  <span className='text-sm font-medium text-foreground'>৳{fmt(item.price)}</span>
                                )}
                              </TableCell>
                              <TableCell className='text-right'>
                                {editingItems ? (
                                  <div className='inline-flex items-center border border-input rounded-md bg-background shadow-xs ml-auto'>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      className='h-7 w-7 rounded-none rounded-l-md hover:bg-muted text-muted-foreground'
                                      onClick={() => {
                                        const newItems = [...orderItems]
                                        newItems[index].quantity = Math.max(1, (newItems[index].quantity || 1) - 1)
                                        setOrderItems(newItems)
                                      }}
                                    >
                                      <Minus className='h-3 w-3' />
                                    </Button>
                                    <span className='text-xs font-semibold w-7 text-center'>{item.quantity}</span>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      className='h-7 w-7 rounded-none rounded-r-md hover:bg-muted text-muted-foreground'
                                      onClick={() => {
                                        const newItems = [...orderItems]
                                        newItems[index].quantity = (newItems[index].quantity || 1) + 1
                                        setOrderItems(newItems)
                                      }}
                                    >
                                      <Plus className='h-3 w-3' />
                                    </Button>
                                  </div>
                                ) : (
                                  <span className='inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-md bg-muted/70 text-xs font-semibold text-foreground'>
                                    × {item.quantity}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className='text-right pr-4 sm:pr-6 text-sm font-semibold text-foreground'>
                                ৳{fmt(nn(item.price) * item.quantity)}
                              </TableCell>
                              {editingItems && (
                                <TableCell className='text-center'>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className='h-7 w-7 text-destructive hover:bg-destructive/10'
                                    onClick={() => setOrderItems(orderItems.filter((_, i) => i !== index))}
                                  >
                                    <X className='h-3.5 w-3.5' />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile Compact Card View */}
                  <div className='md:hidden divide-y divide-border/50'>
                    {(editingItems ? orderItems : order.items)?.map((item: any, index: number) => {
                      const itemImages = resolveOrderItemImages(
                        item.product ?? item.variant?.product,
                        item.variant,
                      )
                      return (
                        <div key={item.id || index} className='p-3.5 space-y-2.5 bg-card'>
                          {/* Product Info Row */}
                          <div className='flex items-start gap-3'>
                            {itemImages.hasImage ? (
                              <SafeImage
                                src={mediaUrl(itemImages.image)}
                                fallbackSrc={mediaUrl(itemImages.colorImage ?? itemImages.productImage)}
                                alt=''
                                className='h-12 w-12 rounded-lg border border-border/70 object-cover flex-shrink-0 bg-muted/40 shadow-xs'
                                thumbWidth={48}
                                thumbHeight={48}
                              />
                            ) : (
                              <div className='h-12 w-12 rounded-lg border border-border/70 bg-muted/50 flex items-center justify-center flex-shrink-0 text-muted-foreground shadow-xs'>
                                <Package className='h-5 w-5 opacity-70' />
                              </div>
                            )}
                            <div className='min-w-0 flex-1 space-y-1'>
                              <span className='text-sm font-medium text-foreground block leading-snug line-clamp-2'>{item.product?.name}</span>
                              <div className='flex flex-wrap items-center gap-1.5'>
                                {item.variant && item.variant.attributeValues?.length > 0 && (
                                  <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted/60 text-muted-foreground border border-border/40'>
                                    {item.variant.attributeValues.map((av: any) => av.attributeValue?.value).filter(Boolean).join(' / ')}
                                  </span>
                                )}
                                {item.variant?.sku ? (
                                  <span className='text-[11px] text-muted-foreground/75 font-mono inline-flex items-center gap-0.5'>
                                    SKU: <span className='font-semibold text-foreground/80'>{item.variant.sku}</span>
                                  </span>
                                ) : item.product?.sku ? (
                                  <span className='text-[11px] text-muted-foreground/75 font-mono inline-flex items-center gap-0.5'>
                                    SKU: <span className='font-semibold text-foreground/80'>{item.product.sku}</span>
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {editingItems && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0'
                                onClick={() => setOrderItems(orderItems.filter((_, i) => i !== index))}
                              >
                                <X className='h-4 w-4' />
                              </Button>
                            )}
                          </div>

                          {/* Price & Quantity Controls */}
                          {editingItems ? (
                            <div className='flex items-center justify-between gap-2 pt-2 border-t border-border/40'>
                              <div className='flex items-center gap-1.5'>
                                <span className='text-xs text-muted-foreground'>Price: ৳</span>
                                <Input
                                  type='number'
                                  value={item.price}
                                  onChange={e => {
                                    const newItems = [...orderItems]
                                    newItems[index].price = parseFloat(e.target.value) || 0
                                    setOrderItems(newItems)
                                  }}
                                  className='w-20 text-right h-8 text-xs font-medium'
                                />
                              </div>
                              <div className='flex items-center gap-3'>
                                <div className='inline-flex items-center border border-input rounded-md bg-background shadow-xs'>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className='h-7 w-7 rounded-none rounded-l-md hover:bg-muted text-muted-foreground'
                                    onClick={() => {
                                      const newItems = [...orderItems]
                                      newItems[index].quantity = Math.max(1, (newItems[index].quantity || 1) - 1)
                                      setOrderItems(newItems)
                                    }}
                                  >
                                    <Minus className='h-3 w-3' />
                                  </Button>
                                  <span className='text-xs font-semibold w-7 text-center'>{item.quantity}</span>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className='h-7 w-7 rounded-none rounded-r-md hover:bg-muted text-muted-foreground'
                                    onClick={() => {
                                      const newItems = [...orderItems]
                                      newItems[index].quantity = (newItems[index].quantity || 1) + 1
                                      setOrderItems(newItems)
                                    }}
                                  >
                                    <Plus className='h-3 w-3' />
                                  </Button>
                                </div>
                                <div className='text-right'>
                                  <span className='text-xs font-semibold text-foreground'>
                                    ৳{fmt(nn(item.price) * item.quantity)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className='flex items-center justify-between pt-1.5 border-t border-border/30 text-xs'>
                              <div className='text-muted-foreground flex items-center gap-1.5'>
                                <span>৳{fmt(item.price)}</span>
                                <span className='inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-muted/70 text-[11px] font-semibold text-foreground'>
                                  × {item.quantity}
                                </span>
                              </div>
                              <div className='text-sm font-semibold text-foreground'>
                                ৳{fmt(nn(item.price) * item.quantity)}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Add product search row in editing mode (shared for both desktop and mobile) */}
                  {editingItems && (
                    <div className='p-3 bg-muted/20 border-t border-border/50'>
                      <Command className='border rounded-lg shadow-sm bg-background' shouldFilter={false}>
                        <CommandInput
                          placeholder='Search or scan product by name or SKU...'
                          value={productSearchQuery}
                          onValueChange={setProductSearchQuery}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              const exact = productSearchResults.find((p: any) => p.sku === productSearchQuery || p.variants?.some((v: any) => v.sku === productSearchQuery))
                              if (exact) {
                                const variant = exact.variants?.find((v: any) => v.sku === productSearchQuery)
                                setOrderItems([...orderItems, { productId: exact.id, variantId: variant?.id, product: exact, quantity: 1, price: variant?.salePrice ?? variant?.price ?? exact.salePrice ?? exact.basePrice ?? 0 }])
                                setProductSearchQuery('')
                                toast.success('Product added')
                              } else {
                                toast.error('Product not found with this SKU')
                              }
                            }
                          }}
                        />
                        {productSearchQuery && (
                          <CommandList className='max-h-52 overflow-y-auto'>
                            <CommandEmpty className='p-4 text-xs text-muted-foreground text-center'>No matching products found.</CommandEmpty>
                            <CommandGroup>
                              {productSearchResults
                                .filter((p: any) => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) || p.sku?.toLowerCase().includes(productSearchQuery.toLowerCase()) || p.variants?.some((v: any) => v.sku?.toLowerCase().includes(productSearchQuery.toLowerCase())))
                                .map((p: any) => (
                                  <CommandItem
                                    key={p.id}
                                    value={p.name}
                                    onSelect={() => {
                                      if (p.type === 'variable' || p.variants?.length > 0) {
                                        setSelectedProductForVariants(p)
                                      } else {
                                        setOrderItems([...orderItems, { productId: p.id, product: p, quantity: 1, price: p.salePrice ?? p.basePrice ?? 0 }])
                                        setProductSearchQuery('')
                                      }
                                    }}
                                    className='flex items-center gap-3 p-2.5 cursor-pointer rounded-md'
                                  >
                                    {p.images && Array.isArray(p.images) && p.images[0] ? (
                                      <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-9 w-9 rounded-md border object-cover' thumbWidth={48} thumbHeight={48} />
                                    ) : (
                                      <div className='h-9 w-9 rounded-md border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
                                    )}
                                    <div className='flex-1 min-w-0'>
                                      <p className='text-sm font-medium truncate text-foreground'>{p.name}</p>
                                      <p className='text-xs text-muted-foreground font-mono'>{p.sku || 'No SKU'}</p>
                                    </div>
                                    <div className='text-sm font-semibold text-foreground'>৳{fmt(ep(p))}</div>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        )}
                      </Command>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Order Summary — inline editable (placed directly below Ordered Items) */}
              <OrderSummaryCard
                subtotal={nn(order.subtotal)}
                shippingCharge={nn(order.shippingCharge)}
                discount={nn(order.discount)}
                discountType={(order.discountType as 'flat' | 'percentage') || 'flat'}
                total={nn(order.total)}
                shippingMode={shippingMode}
                shippingOptions={shippingOptions as any}
                selectedShippingOptionId={order.selectedShippingOptionId || ''}
                shippingChargeOverridden={order.shippingChargeOverridden}
                freeDeliveryMin={Number(sysSettings?.['free_delivery_min'] || 0)}
                onSaveShipping={handleSaveShipping}
                onSaveDiscount={handleSaveDiscount}
                shippingCost={order.shippingCost ?? null}
                shippingCostSource={order.shippingCostSource ?? null}
                onSaveFulfillmentCost={handleSaveFulfillmentCost}
                isSaving={updateMut.isPending}
                paidAmount={getOrderPaidAmount(order)}
                dueAmount={getOrderDueAmount(order)}
              />

              {/* Payment Details Card */}
              {(order.paymentOptionType || editingPayment || (order.payments && order.payments.length > 0)) && (
                <Card className='overflow-hidden border border-border/70 shadow-xs'>
                  <CardHeader className='bg-muted/30 border-b border-border/50 py-2.5 px-3.5 sm:py-3.5 sm:px-6'>
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2.5'>
                        <div className='h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-semibold'>
                          <CreditCard className='h-4 w-4' />
                        </div>
                        <div>
                          <CardTitle className='text-sm font-semibold tracking-tight text-foreground flex items-center gap-2'>
                            Payment Details
                            <PaymentStatusBadge status={getOrderPaymentMode(order)} />
                          </CardTitle>
                          <p className='text-xs text-muted-foreground mt-0.5'>Settlement mode and transaction log</p>
                        </div>
                      </div>
                      {!editingPayment && (
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-8 text-xs font-medium shadow-none hover:bg-accent'
                          onClick={openPaymentEdit}
                          disabled={!paymentEditAllowed}
                          title={paymentEditAllowed ? undefined : 'Payment editing is disabled — record a correction entry instead'}
                        >
                          <Pencil className='h-3 w-3 mr-1.5' /> Edit
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className='p-3 sm:p-6 space-y-3 sm:space-y-4'>
                    {/* D6: three unmistakable blocks — ledger-derived, never the stored column */}
                    {(() => {
                      const total = nn(order.total)
                      const paid = getOrderPaidAmount(order)
                      const due = getOrderDueAmount(order)
                      return (
                        <div className='grid grid-cols-3 gap-2'>
                          <div className='rounded-lg bg-muted/40 border border-border/50 p-2.5 text-center'>
                            <p className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>মোট বিল</p>
                            <p className='font-bold text-sm text-foreground mt-0.5'>৳{fmt(total)}</p>
                          </div>
                          <div className='rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-center'>
                            <p className='text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400'>আদায়কৃত</p>
                            <p className='font-bold text-sm text-emerald-600 dark:text-emerald-400 mt-0.5'>৳{fmt(paid)}</p>
                          </div>
                          <div className='rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5 text-center ring-1 ring-amber-500/20'>
                            <p className='text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-500'>বকেয়া Due</p>
                            <p className='font-extrabold text-base text-amber-600 dark:text-amber-500 mt-0.5'>৳{fmt(due)}</p>
                          </div>
                        </div>
                      )
                    })()}
                    {editingPayment ? (
                      <div className='space-y-3.5'>
                        <div>
                          <Label className='text-xs font-medium'>Payment Method</Label>
                          <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-xs mt-1 font-medium' value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                            <option value='cash'>Cash</option>
                            <option value='bkash'>bKash</option>
                            <option value='nagad'>Nagad</option>
                            <option value='bank'>Bank</option>
                            <option value='card'>Card</option>
                          </select>
                        </div>
                        <div>
                          <Label className='text-xs font-medium'>Payment Mode</Label>
                          <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-xs mt-1 font-medium' value={paymentMode} onChange={e => setPaymentMode(e.target.value as any)}>
                            <option value='cod'>Cash on Delivery (COD)</option>
                            <option value='full'>Full Payment</option>
                            <option value='partial'>Partial Payment</option>
                          </select>
                        </div>
                        {paymentMode === 'partial' && (
                          <div>
                            <Label className='text-xs font-medium'>Partial Amount to Collect</Label>
                            <Input type='number' step='0.01' value={partialAmount} onChange={e => setPartialAmount(e.target.value)} className='h-9 text-xs mt-1 font-medium' placeholder='Amount in BDT' />
                            {(order?.payments || []).some((p: any) => p.status === 'PAID') && (
                              <p className='text-[11px] text-muted-foreground mt-1'>
                                Collected ৳{fmt((order?.payments || []).filter((p: any) => p.status === 'PAID').reduce((s: number, p: any) => s + Number(p.amount || 0), 0))} so far (locked) — the remainder becomes ৳{fmt(Math.max(0, nn(order?.total) - (parseFloat(partialAmount) || 0)))}. Lowering below collected needs a refund first; the method change applies to the outstanding balance row.
                              </p>
                            )}
                          </div>
                        )}
                        <div className='flex gap-2 pt-1'>
                          <Button size='sm' className='h-8 text-xs font-medium' onClick={handleSavePayment} disabled={updateMut.isPending}>
                            {updateMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin mr-1.5' /> : <Save className='h-3.5 w-3.5 mr-1.5' />} Save
                          </Button>
                          <Button size='sm' variant='ghost' className='h-8 text-xs font-medium' onClick={() => setEditingPayment(false)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className='rounded-lg bg-muted/40 border border-border/50 p-3 space-y-2 text-xs'>
                        <div className='flex items-center justify-between'>
                          <span className='text-muted-foreground'>Method / Mode:</span>
                          <span className='font-semibold text-foreground'>{paymentOptionTypeLabel(order?.paymentOptionType ?? '')}</span>
                        </div>
                        {order?.partialAmount && (
                          <div className='flex items-center justify-between pt-1.5 border-t border-border/40'>
                            <span className='text-muted-foreground'>Partial Amount:</span>
                            <span className='font-bold text-foreground'>৳{fmt(order.partialAmount)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Append-only ledger: signed entries, no in-place edits */}
                    <PaymentLedgerCard
                      payments={(order.payments || []) as any}
                      onRecordPayment={() => setShowRecordPayment(true)}
                      onRecordRefund={() => setShowRecordRefund(true)}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Timeline Card */}
              <Card className='overflow-hidden border border-border/70 shadow-xs'>
                <CardHeader className='bg-muted/30 border-b border-border/50 py-2.5 px-3.5 sm:py-3.5 sm:px-6'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2.5'>
                      <div className='h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-semibold'>
                        <Clock className='h-4 w-4' />
                      </div>
                      <div>
                        <CardTitle className='text-sm font-semibold tracking-tight text-foreground flex items-center gap-2'>
                          Order Timeline & Activity
                          <Badge variant='secondary' className='text-[11px] font-medium px-2 py-0.5 rounded-full'>
                            {order.timeline?.length || 0}
                          </Badge>
                        </CardTitle>
                        <p className='text-xs text-muted-foreground mt-0.5'>Audit trail of status transitions, courier updates, and staff notes</p>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='p-3 sm:p-6'>
                  {!order.timeline || order.timeline.length === 0 ? (
                    <div className='text-center py-8 text-muted-foreground'>
                      <Clock className='h-8 w-8 mx-auto mb-2 opacity-30' />
                      <p className='text-sm font-medium text-foreground'>No activity recorded yet</p>
                      <p className='text-xs text-muted-foreground mt-0.5'>Lifecycle changes and internal notes will appear here.</p>
                    </div>
                  ) : (
                    <div className='space-y-0 pl-1'>
                      {(order.timeline as any[]).map((t: any, i: number) => {
                        const isStatus = !!t.status && !t.type
                        const isPrivate = t.visibility === 'private'
                        const color = isStatus ? (statusColors[t.status] || '#6B7280') : isPrivate ? '#8B5CF6' : '#6366F1'
                        const prev = i > 0 ? (order.timeline as any[])[i - 1] : null
                        const prevIsStatus = !!prev?.status && !prev?.type
                        const isGrouped = prev && (t.type === prev.type || (isStatus && prevIsStatus))
                        const performer = t.performedBy || t.performer || ''
                        const performerEmail = performer.includes('@') ? performer : undefined
                        return (
                          <div
                            key={i}
                            className={`relative pl-6 pb-5 border-l-2 last:border-l-transparent last:pb-0 ${isGrouped ? 'border-dashed' : ''}`}
                            style={{ borderColor: color }}
                          >
                            <div
                              className='absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 bg-background'
                              style={{ borderColor: color }}
                            />
                            <div className='flex items-center gap-2 flex-wrap'>
                              {isStatus && t.oldStatus ? (
                                <div className='flex items-center gap-1.5'>
                                  <Badge variant='outline' className='text-xs font-medium'>{t.oldStatus}</Badge>
                                  <ArrowRight className='h-3 w-3 text-muted-foreground' />
                                  <Badge style={{ backgroundColor: color, color: '#fff' }} className='text-xs font-medium shadow-xs'>{t.status}</Badge>
                                </div>
                              ) : isStatus && (
                                <Badge style={{ backgroundColor: color, color: '#fff' }} className='text-xs font-medium shadow-xs'>{t.status}</Badge>
                              )}
                              {t.type === 'shipping' && (
                                <Badge variant='outline' className='text-xs font-medium bg-muted/40'>
                                  <ArrowRightLeft className='h-3 w-3 mr-1' />Shipping
                                </Badge>
                              )}
                              {t.type === 'discount' && (
                                <Badge variant='outline' className='text-xs font-medium bg-muted/40'>
                                  <Tag className='h-3 w-3 mr-1' />Discount
                                </Badge>
                              )}
                              {t.type === 'note' && (
                                <Badge variant='outline' className='text-xs font-medium bg-muted/40'>
                                  <MessageSquarePlus className='h-3 w-3 mr-1' />Note
                                </Badge>
                              )}
                              {t.type === 'courier' && (
                                <Badge variant='outline' className='text-xs font-medium bg-muted/40'>
                                  <Truck className='h-3 w-3 mr-1' />{(t as any).courier}
                                </Badge>
                              )}
                              {isPrivate && (
                                <Badge variant='secondary' className='text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'>
                                  <EyeOff className='h-2.5 w-2.5 mr-1' />Private
                                </Badge>
                              )}
                              {performer && performer !== 'System' && performer !== 'Customer' && (
                                <UserBadge email={performerEmail || performer} showEmail={false} size='sm' />
                              )}
                              {performer === 'System' && (
                                <Badge variant='secondary' className='text-[10px] h-4 font-normal'>Auto</Badge>
                              )}
                              {performer === 'Customer' && (
                                <Badge variant='secondary' className='text-[10px] h-4 font-normal'>Customer</Badge>
                              )}
                              <span className='text-xs text-muted-foreground inline-flex items-center gap-1 ml-auto'>
                                <Clock className='h-3 w-3' />{new Date(t.timestamp).toLocaleString()}
                              </span>
                            </div>
                            {t.note && (
                              <div className={`mt-2 rounded-lg p-3 text-xs border ${isPrivate ? 'bg-purple-500/5 border-purple-500/20 text-purple-950 dark:text-purple-200' : 'bg-muted/40 border-border/60 text-foreground'}`}>
                                <p className='leading-relaxed font-normal'>{t.note}</p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Add note — integrated in Timeline footer */}
                  <div className='mt-5 pt-4 border-t border-border/60'>
                    <div className='flex items-center gap-2 bg-muted/20 border border-border/70 rounded-lg p-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:border-primary transition-all'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={noteVisibility === 'private' ? 'secondary' : 'ghost'}
                            size='sm'
                            className={`h-7 px-2 text-xs font-medium gap-1.5 shrink-0 ${noteVisibility === 'private' ? 'text-purple-600 dark:text-purple-400 bg-purple-500/10' : 'text-muted-foreground'}`}
                            onClick={() => setNoteVisibility(v => v === 'public' ? 'private' : 'public')}
                          >
                            {noteVisibility === 'public' ? <Eye className='h-3.5 w-3.5' /> : <EyeOff className='h-3.5 w-3.5' />}
                            <span className='capitalize hidden sm:inline'>{noteVisibility}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{noteVisibility === 'public' ? 'Public note (visible to all staff)' : 'Private staff note'} — click to toggle</TooltipContent>
                      </Tooltip>
                      <Input
                        placeholder={`Add ${noteVisibility} note… (Press Enter to post)`}
                        className='text-xs h-7 flex-1 border-0 shadow-none focus-visible:ring-0 bg-transparent px-2'
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && noteText.trim()) {
                            noteMut.mutate({ id, note: noteText.trim(), visibility: noteVisibility })
                            setNoteText('')
                          }
                        }}
                      />
                      <Button
                        size='sm'
                        className='h-7 px-2.5 sm:px-3 text-xs font-medium gap-1.5 shrink-0'
                        disabled={!noteText.trim() || noteMut.isPending}
                        onClick={() => { if (noteText.trim()) { noteMut.mutate({ id, note: noteText.trim(), visibility: noteVisibility }); setNoteText('') } }}
                      >
                        {noteMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <Send className='h-3 w-3' />}
                        <span className='hidden sm:inline'>Post</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Dispatch History */}
              <Card className='overflow-hidden border border-border/70 shadow-xs'>
                <CardHeader className='bg-muted/30 border-b border-border/50 py-2.5 px-3.5 sm:py-3.5 sm:px-6'>
                  <div className='flex items-center gap-2.5'>
                    <div className='h-8 w-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center font-semibold'>
                      <Truck className='h-4 w-4' />
                    </div>
                    <div>
                      <CardTitle className='text-sm font-semibold tracking-tight text-foreground flex items-center gap-2'>
                        Courier Dispatch History
                        {(order.dispatches?.length ?? 0) > 0 && (
                          <Badge variant='secondary' className='text-[11px] font-medium px-2 py-0.5 rounded-full'>
                            {order.dispatches?.length}
                          </Badge>
                        )}
                      </CardTitle>
                      <p className='text-xs text-muted-foreground mt-0.5'>Consignment tracking and courier status logs</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='p-0'>
                  {order.dispatches && order.dispatches.length > 0 ? (
                    <>
                      {/* Desktop Table View */}
                      <div className='hidden md:block overflow-x-auto'>
                        <Table>
                          <TableHeader>
                            <TableRow className='bg-muted/15 border-b border-border/40 hover:bg-muted/15'>
                              <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10 px-4 sm:px-6'>Courier</TableHead>
                              <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10'>Consignment ID</TableHead>
                              <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10'>Status</TableHead>
                              <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10'>Tracking Code</TableHead>
                              <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground h-10 pr-4 sm:pr-6 text-right'>Date</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {order.dispatches.slice().reverse().map((d: any) => {
                              const statusConfig = DISPATCH_STATUSES.find(s => s.value === d.status)
                              return (
                                <TableRow key={d.id} className='hover:bg-muted/30 transition-colors'>
                                  <TableCell className='px-4 sm:px-6 font-semibold text-sm capitalize text-foreground'>
                                    {d.courier}
                                  </TableCell>
                                  <TableCell>
                                    <div className='flex items-center gap-1.5'>
                                      <span className='text-sm font-mono font-medium'>{d.consignmentId}</span>
                                      <CopyButton text={d.consignmentId} label='Consignment ID' />
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Badge className={`text-xs font-medium shadow-xs ${statusConfig?.color || 'bg-gray-500'}`}>
                                      {statusConfig?.label || d.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    {d.trackingCode ? (
                                      <div className='flex items-center gap-1.5'>
                                        <span className='font-mono text-xs bg-muted/60 px-2 py-0.5 rounded border border-border/40'>{d.trackingCode}</span>
                                        {d.trackingUrl && (
                                          <a href={d.trackingUrl} target='_blank' rel='noreferrer' title='Track shipment' className='text-muted-foreground hover:text-primary transition-colors'>
                                            <ExternalLink className='h-3.5 w-3.5' />
                                          </a>
                                        )}
                                      </div>
                                    ) : (
                                      <span className='text-sm text-muted-foreground'>—</span>
                                    )}
                                  </TableCell>
                                  <TableCell className='text-xs text-muted-foreground pr-4 sm:pr-6 text-right'>
                                    {new Date(d.createdAt).toLocaleString()}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Mobile Compact Card View */}
                      <div className='md:hidden divide-y divide-border/50'>
                        {order.dispatches.slice().reverse().map((d: any) => {
                          const statusConfig = DISPATCH_STATUSES.find(s => s.value === d.status)
                          return (
                            <div key={d.id} className='p-3.5 space-y-2 bg-card'>
                              <div className='flex items-center justify-between'>
                                <span className='font-semibold text-sm capitalize text-foreground'>{d.courier}</span>
                                <Badge className={`text-[11px] font-medium shadow-xs ${statusConfig?.color || 'bg-gray-500'}`}>
                                  {statusConfig?.label || d.status}
                                </Badge>
                              </div>
                              <div className='flex items-center justify-between text-xs'>
                                <div className='flex items-center gap-1.5'>
                                  <span className='font-mono text-xs font-medium text-foreground'>{d.consignmentId}</span>
                                  <CopyButton text={d.consignmentId} label='Consignment ID' />
                                </div>
                                <span className='text-[11px] text-muted-foreground'>
                                  {new Date(d.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} {new Date(d.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              {d.trackingCode && (
                                <div className='flex items-center justify-between pt-1 border-t border-border/30 text-xs'>
                                  <span className='text-muted-foreground text-[11px]'>Tracking:</span>
                                  <div className='flex items-center gap-1.5'>
                                    <span className='font-mono text-[11px] bg-muted/60 px-2 py-0.5 rounded border border-border/40'>{d.trackingCode}</span>
                                    {d.trackingUrl && (
                                      <a href={d.trackingUrl} target='_blank' rel='noreferrer' title='Track shipment' className='text-muted-foreground hover:text-primary transition-colors'>
                                        <ExternalLink className='h-3.5 w-3.5' />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <div className='flex flex-col items-center justify-center py-8 px-4 text-center'>
                      <div className='h-10 w-10 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground/60 mb-2'>
                        <Truck className='h-5 w-5' />
                      </div>
                      <p className='text-sm font-medium text-foreground'>Not Dispatched Yet</p>
                      <p className='text-xs text-muted-foreground max-w-xs mt-0.5'>This order has not been handed over or booked with any delivery partner yet.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Return relationship (RTN) ─────────────────────────── */}
              {(order.kind === 'RETURN' || rtnOrder) && (
                <Card className={`overflow-hidden shadow-xs border ${order.kind === 'RETURN' ? 'border-pink-500/40 bg-pink-500/[0.02]' : 'border-border/70'}`}>
                  <CardHeader className='bg-muted/30 border-b border-border/50 py-2.5 px-3.5 sm:py-3.5 sm:px-6'>
                    <div className='flex items-center gap-2.5'>
                      <div className='h-8 w-8 rounded-lg bg-pink-500/10 text-pink-500 flex items-center justify-center font-semibold'>
                        <RotateCcw className='h-4 w-4' />
                      </div>
                      <div>
                        <CardTitle className='text-sm font-semibold tracking-tight text-foreground flex items-center gap-2'>
                          Return Relationship
                        </CardTitle>
                        <p className='text-xs text-muted-foreground mt-0.5'>Linked return order and item restitution state</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className='p-3 sm:p-6 flex flex-col gap-3'>
                    {order.kind === 'RETURN' && order.returnOfOrder && (
                      <div className='text-xs text-muted-foreground flex items-center gap-1.5'>
                        <span>Original Order:</span>
                        <Link to='/op/orders/$id' params={{ id: order.returnOfOrder.id }} className='font-semibold text-primary hover:underline font-mono'>
                          {order.returnOfOrder.displayId}
                        </Link>
                      </div>
                    )}
                    {order.kind !== 'RETURN' && rtnOrder && (
                      <div className='text-xs text-muted-foreground flex items-center gap-1.5'>
                        <span>Linked Return Order:</span>
                        <Link to='/op/orders/$id' params={{ id: rtnOrder.id }} className='font-semibold text-primary hover:underline font-mono'>
                          {rtnOrder.displayId}
                        </Link>
                      </div>
                    )}
                    {rtnOrder && (
                      <div className='grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40 border border-border/50'>
                        <div className='flex items-center gap-2'>
                          <span className='text-xs text-muted-foreground'>Return Status:</span>
                          <Badge
                            style={{ backgroundColor: statusColors[rtnOrder.status] || '#6B7280', color: '#fff' }}
                            className='text-xs font-medium'
                          >
                            {rtnOrder.status}
                          </Badge>
                        </div>
                        <div className='text-xs text-muted-foreground'>
                          Items Returned: <span className='font-semibold text-foreground'>{rtnOrder.itemCount}</span>
                        </div>
                        {order.dispatches && order.dispatches.length > 0 && (
                          <div className='text-xs text-muted-foreground flex items-center gap-1.5 col-span-2'>
                            <Truck className='h-3.5 w-3.5 text-muted-foreground' />
                            <span>{order.dispatches[order.dispatches.length - 1].courier} — {order.dispatches[order.dispatches.length - 1].consignmentId}</span>
                          </div>
                        )}
                        {rtnOrder.status === 'Returned' && (
                          <p className='text-[11px] text-emerald-600 font-medium col-span-2'>Returned quantities have been restored to stock.</p>
                        )}
                        {rtnOrder.status === 'Return Pending' && (
                          <p className='text-[11px] text-muted-foreground col-span-2'>
                            Stock is restored when the return dispatch is confirmed (Scanner → Dispatch → Return).
                          </p>
                        )}
                      </div>
                    )}
                    {order.kind === 'RETURN' && (
                      <div className='text-xs text-muted-foreground flex flex-col gap-1.5 p-3 rounded-lg bg-muted/40 border border-border/50'>
                        <span>Returned At: <strong className='text-foreground'>{order.returnedAt ? new Date(order.returnedAt).toLocaleString() : '—'}</strong></span>
                        <span>Stock Restored: <strong className='text-foreground'>{order.stockRestored ? 'Yes' : 'No'}</strong></span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ════ RIGHT COLUMN (5/12 or 4/12) ════ */}
            <div className='xl:col-span-5 2xl:col-span-4 space-y-3.5 sm:space-y-6'>

              {/* Customer & Delivery Card (with Integrated Customer Lifetime Value) */}
              <Card className='overflow-hidden border border-border/70 shadow-xs'>
                <CardHeader className='bg-muted/30 border-b border-border/50 py-2.5 px-3.5 sm:py-3.5 sm:px-6'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2 sm:gap-2.5'>
                      <div className='h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-semibold'>
                        <User className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
                      </div>
                      <div>
                        <CardTitle className='text-xs sm:text-sm font-semibold tracking-tight text-foreground'>
                          Customer & Delivery
                        </CardTitle>
                        <p className='text-[10px] sm:text-xs text-muted-foreground mt-0.5'>Profile, address & lifetime metrics</p>
                      </div>
                    </div>
                    <Button variant='outline' size='sm' className='h-7 sm:h-8 text-xs font-medium shadow-none hover:bg-accent' onClick={() => setShowCustomerSheet(true)}>
                      <Pencil className='h-3 w-3 mr-1 sm:mr-1.5' /> Edit
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className='p-3 sm:p-6 space-y-3 sm:space-y-4'>
                  <div className='flex items-start gap-2.5 sm:gap-3'>
                    <div className='h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs sm:text-sm uppercase shrink-0 ring-2 ring-primary/20'>
                      {(getCustomerDisplayName(order) || 'G')[0]}
                    </div>
                    <div className='min-w-0 flex-1 space-y-0.5 sm:space-y-1'>
                      <p className='font-semibold text-xs sm:text-sm text-foreground truncate'>
                        {order.customerId ? (
                          <Link
                            to='/op/customers/$id'
                            params={{ id: order.customerId }}
                            className='hover:text-primary hover:underline transition-colors'
                          >
                            {getCustomerDisplayName(order)}
                          </Link>
                        ) : (
                          getCustomerDisplayName(order)
                        )}
                      </p>
                      {getCustomerEmail(order) && (
                        <p className='text-muted-foreground text-[11px] sm:text-xs flex items-center gap-1.5'>
                          <Mail className='h-3 w-3 shrink-0' />
                          <span className='truncate'>{getCustomerEmail(order)}</span>
                        </p>
                      )}
                      {getCustomerPhone(order) && (
                        <div className='text-muted-foreground text-[11px] sm:text-xs flex items-center gap-1.5 sm:gap-2 flex-wrap pt-0.5'>
                          <a href={`tel:${getCustomerPhone(order)}`} className='flex items-center gap-1 font-medium hover:text-primary transition-colors text-foreground'>
                            <Phone className='h-3 w-3 text-muted-foreground' />
                            <span>{getCustomerPhone(order)}</span>
                          </a>
                          <CustomerContactActions phone={getCustomerPhone(order)} />
                          <button
                            onClick={() => setBlockPhones({ phones: [getCustomerPhone(order)], contextLabel: order.displayId })}
                            className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors'
                            title='Block this phone from ordering'
                          >
                            <Ban className='h-3 w-3' />Block
                          </button>
                        </div>
                      )}
                      {(order as any).secondaryPhone && (
                        <div className='text-muted-foreground text-[11px] sm:text-xs flex items-center gap-1.5 sm:gap-2 flex-wrap pt-0.5'>
                          <a href={`tel:${(order as any).secondaryPhone}`} className='flex items-center gap-1 font-medium hover:text-primary transition-colors text-foreground'>
                            <Phone className='h-3 w-3 text-muted-foreground' />
                            <span>{(order as any).secondaryPhone}</span>
                          </a>
                          <span className='rounded border border-border/60 px-1 py-px text-[9px] sm:text-[10px] text-muted-foreground'>2nd</span>
                          <CustomerContactActions phone={(order as any).secondaryPhone} />
                          <button
                            onClick={() => setBlockPhones({ phones: [(order as any).secondaryPhone], contextLabel: order.displayId })}
                            className='inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors'
                            title='Block this phone from ordering'
                          >
                            <Ban className='h-3 w-3' />Block
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {order.shippingAddress && (
                    <div className='rounded-lg bg-muted/40 border border-border/50 p-2.5 sm:p-3 space-y-1'>
                      <div className='flex items-center gap-1.5 text-xs font-semibold text-foreground'>
                        <MapPin className='h-3.5 w-3.5 text-primary shrink-0' />
                        <span>Delivery Address</span>
                      </div>
                      <div className='text-xs text-muted-foreground leading-relaxed pl-5'>
                        {(order.shippingAddress.address || order.shippingAddress.addressLine) && (
                          <p className='text-foreground font-normal'>{order.shippingAddress.address || order.shippingAddress.addressLine}</p>
                        )}
                        {(order.shippingAddress.city || order.shippingAddress.zone) && (
                          <p className='text-[11px] sm:text-xs text-muted-foreground mt-0.5'>
                            {[order.shippingAddress.zone?.name || order.shippingAddress.zone, order.shippingAddress.city?.name || order.shippingAddress.city].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {(order.customerNotes || order.officeNotes) && (
                    <div className='space-y-2 pt-0.5'>
                      {order.customerNotes && (
                        <div className='bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5 sm:p-3 text-xs text-foreground'>
                          <p className='text-blue-600 dark:text-blue-400 mb-0.5 sm:mb-1 font-semibold flex items-center gap-1.5'>
                            <MessageSquarePlus className='h-3.5 w-3.5' /> Customer Note
                          </p>
                          <p className='leading-relaxed'>{order.customerNotes}</p>
                        </div>
                      )}
                      {order.officeNotes && (
                        <div className='bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 sm:p-3 text-xs text-foreground'>
                          <p className='text-amber-600 dark:text-amber-400 mb-0.5 sm:mb-1 font-semibold flex items-center gap-1.5'>
                            <AlertTriangle className='h-3.5 w-3.5' /> Office Note (Internal)
                          </p>
                          <p className='leading-relaxed'>{order.officeNotes}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Compact Integrated Customer Lifetime Value ── */}
                  <div className='rounded-lg bg-muted/30 border border-border/60 p-2.5 sm:p-3 space-y-2'>
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-1.5 text-xs font-semibold text-foreground'>
                        <ShoppingBag className='h-3.5 w-3.5 text-violet-500 shrink-0' />
                        <span>Customer Lifetime Value</span>
                      </div>
                      {customerSummary?.summary?.totalOrders > 0 && (
                        <span className='text-[10px] font-medium text-muted-foreground'>
                          {customerSummary.summary.totalOrders} {customerSummary.summary.totalOrders === 1 ? 'order' : 'orders'} total
                        </span>
                      )}
                    </div>

                    {customerSummary?.customer ? (
                      <div className='space-y-2'>
                        <div className='grid grid-cols-3 gap-1.5 sm:gap-2'>
                          <div className='rounded-md bg-background/80 border border-border/40 p-1.5 sm:p-2 text-center min-w-0'>
                            <p className='text-sm sm:text-base font-bold text-foreground truncate'>{customerSummary.summary.totalOrders}</p>
                            <p className='text-[9px] sm:text-[10px] text-muted-foreground font-medium truncate'>Orders</p>
                          </div>
                          <div className='rounded-md bg-background/80 border border-border/40 p-1.5 sm:p-2 text-center min-w-0'>
                            <p className='text-sm sm:text-base font-bold text-foreground truncate'>৳{nn(customerSummary.summary.totalSpent).toFixed(0)}</p>
                            <p className='text-[9px] sm:text-[10px] text-muted-foreground font-medium truncate'>Total Spent</p>
                          </div>
                          <div className='rounded-md bg-background/80 border border-border/40 p-1.5 sm:p-2 text-center min-w-0'>
                            <p className={`text-sm sm:text-base font-bold truncate ${customerSummary.summary.successRate >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {customerSummary.summary.successRate}%
                            </p>
                            <p className='text-[9px] sm:text-[10px] text-muted-foreground font-medium truncate'>Success Rate</p>
                          </div>
                        </div>

                        <div className='space-y-1 bg-background/60 p-2 rounded-md border border-border/40'>
                          <div className='h-1.5 w-full rounded-full bg-muted overflow-hidden flex shadow-inner'>
                            <div className='h-full bg-emerald-500 transition-all duration-500' style={{ width: `${customerSummary.summary.successRate}%` }} />
                            <div className='h-full bg-rose-500 transition-all duration-500' style={{ width: `${customerSummary.summary.failRate}%` }} />
                          </div>
                          <div className='flex justify-between text-[10px] font-semibold'>
                            <span className='text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1'>
                              <span className='h-1.5 w-1.5 rounded-full bg-emerald-500' />
                              {customerSummary.summary.delivered} Delivered
                            </span>
                            <span className='text-rose-600 dark:text-rose-400 inline-flex items-center gap-1'>
                              <span className='h-1.5 w-1.5 rounded-full bg-rose-500' />
                              {customerSummary.summary.cancelled} Cancelled
                            </span>
                          </div>
                        </div>

                        {customerSummary.recentOrders?.length > 0 && (
                          <Button
                            variant='outline'
                            size='sm'
                            className='w-full h-7 text-xs font-medium gap-1.5 text-muted-foreground hover:text-foreground mt-1 bg-background/80 hover:bg-background shadow-2xs'
                            onClick={() => setShowPastOrdersDialog(true)}
                          >
                            <History className='h-3.5 w-3.5 text-muted-foreground' />
                            <span>View All Past Orders ({customerSummary.recentOrders.length})</span>
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className='text-center py-2 text-muted-foreground'>
                        <p className='text-xs font-medium'>No previous customer orders</p>
                        <p className='text-[10px] text-muted-foreground/75 mt-0.5'>This is their first recorded purchase.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Courier Customer History */}
              <CourierCustomerHistoryCard phone={order.customer?.phoneNumber || order.guestPhone} />

            </div>
          </div>
        </Main>

        <BlockPhoneDialog
          open={!!blockPhones}
          onOpenChange={o => { if (!o) setBlockPhones(null) }}
          phones={blockPhones?.phones || []}
          contextLabel={blockPhones?.contextLabel}
        />

        {canViewOthersInfo && (
          <OthersInfoDialog
            orderId={order.id}
            open={showOthersInfo}
            onOpenChange={setShowOthersInfo}
          />
        )}

        {/* ── Customer Edit Sheet ──────────────────────────────── */}
        <CustomerEditSheet
          open={showCustomerSheet}
          onOpenChange={setShowCustomerSheet}
          firstName={order.customer?.firstName || ''}
          lastName={order.customer?.lastName || ''}
          email={order.customer?.email || ''}
          phone={order.customer?.phoneNumber || ''}
          address={order.shippingAddress?.address || ''}
          cityId={order.shippingAddress?.cityId || ''}
          zoneId={order.shippingAddress?.zoneId || ''}
          customerNotes={order.customerNotes || ''}
          officeNotes={order.officeNotes || ''}
          onSave={handleSaveCustomer}
          isSaving={updateMut.isPending}
        />

        {/* ── Status Change Dialog ─────────────────────────────── */}
        <Dialog open={!!showStatusDialog} onOpenChange={() => setShowStatusDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Change Status</DialogTitle></DialogHeader>
            <div className='space-y-3 py-2'>
              <p className='text-sm'>Current: <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }}>{order.status.name}</Badge></p>
              {showStatusDialog && <p className='text-sm'>New: <Badge style={{ backgroundColor: statusColors[statusList.find((s: any) => s.id === showStatusDialog)?.name] || '#6B7280', color: '#fff' }}>{statusList.find((s: any) => s.id === showStatusDialog)?.name}</Badge></p>}
              <div><Label>Note (optional)</Label><Textarea value={statusNote} onChange={e => setStatusNote(e.target.value)} rows={2} /></div>
            </div>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => { setShowStatusDialog(null); setStatusNote('') }}>Cancel</Button>
              <Button onClick={() => { statusMut.mutate({ id, statusId: showStatusDialog!, note: statusNote || undefined }, { onSuccess: () => { setShowStatusDialog(null); setStatusNote('') } }) }}>Confirm</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Create Return Order (RTN) Dialog ─────────────────── */}
        <ReturnOrderDialog
          order={order}
          open={showRtnDialog}
          onClose={() => { setShowRtnDialog(false); setReturnQtys({}) }}
        />

        {/* ── Customer Past Orders History Dialog ───────────────── */}
        <Dialog open={showPastOrdersDialog} onOpenChange={setShowPastOrdersDialog}>
          <DialogContent className='max-w-xl max-h-[85vh] flex flex-col p-0 overflow-hidden'>
            <DialogHeader className='p-4 sm:p-5 border-b border-border/60 bg-muted/20'>
              <div className='flex items-center gap-2.5'>
                <div className='h-8 w-8 rounded-lg bg-violet-500/10 text-violet-500 flex items-center justify-center font-semibold'>
                  <History className='h-4 w-4' />
                </div>
                <div>
                  <DialogTitle className='text-base font-semibold'>Customer Order History</DialogTitle>
                  <p className='text-xs text-muted-foreground mt-0.5'>
                    {getCustomerDisplayName(order)} · {getCustomerPhone(order) || 'No phone'}
                  </p>
                </div>
              </div>
            </DialogHeader>
            <div className='flex-1 overflow-y-auto p-4 space-y-2'>
              {customerSummary?.recentOrders && customerSummary.recentOrders.length > 0 ? (
                <div className='space-y-1.5'>
                  {customerSummary.recentOrders.map((o: any) => (
                    <div
                      key={o.id}
                      className='flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-card hover:bg-muted/30 transition-colors gap-2'
                    >
                      <div className='min-w-0 space-y-0.5'>
                        <div className='flex items-center gap-1.5'>
                          <Link
                            to='/op/orders/$id'
                            params={{ id: o.id }}
                            onClick={() => setShowPastOrdersDialog(false)}
                            className='font-mono font-medium text-xs text-foreground hover:text-primary transition-colors hover:underline truncate'
                          >
                            {o.displayId}
                          </Link>
                          <CopyButton text={o.displayId} label='Order ID' />
                        </div>
                        {o.createdAt && (
                          <p className='text-[10px] text-muted-foreground'>
                            {new Date(o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        )}
                      </div>
                      <div className='flex items-center gap-2.5 shrink-0'>
                        <span className='font-semibold text-xs text-foreground tabular-nums'>৳{nn(o.total).toFixed(0)}</span>
                        <Badge
                          style={{ backgroundColor: o.status?.color || '#6B7280', color: '#fff' }}
                          className='text-[10px] px-2 py-0.5 font-medium shrink-0'
                        >
                          {o.status?.name}
                        </Badge>
                        <Link
                          to='/op/orders/$id'
                          params={{ id: o.id }}
                          onClick={() => setShowPastOrdersDialog(false)}
                          className='text-muted-foreground hover:text-primary transition-colors p-1'
                          title='View Order'
                        >
                          <ExternalLink className='h-3.5 w-3.5' />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='text-center py-8 text-muted-foreground text-xs'>
                  No previous storefront orders found.
                </div>
              )}
            </div>
            <div className='p-3 border-t border-border/60 bg-muted/20 flex justify-end'>
              <Button variant='outline' size='sm' onClick={() => setShowPastOrdersDialog(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Dispatch Dialog ──────────────────────────────────── */}
        <Dialog open={showDispatchDialog} onOpenChange={() => { setShowDispatchDialog(false); setDispatchCourier('') }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Send to Courier</DialogTitle></DialogHeader>
            <div className='space-y-3 py-2'>
              <p className='text-sm text-muted-foreground'>Select a courier service to dispatch this order.</p>
              <div className='space-y-1'>
                <Label>Courier</Label>
                <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm' value={dispatchCourier} onChange={e => setDispatchCourier(e.target.value)}>
                  <option value=''>Select...</option>
                  {activeCouriers.map((c: any) => (
                    <option key={c.courier} value={c.courier}>{c.courier.charAt(0).toUpperCase() + c.courier.slice(1)}</option>
                  ))}
                </select>
              </div>
              {(() => {
                const due = getOrderDueAmount(order)
                const paid = getOrderPaidAmount(order)
                return (
                  <div className='rounded-lg bg-muted/40 border border-border/60 p-3 space-y-1.5 text-xs mt-2'>
                    <div className='flex justify-between items-center text-muted-foreground'>
                      <span>Order Total:</span>
                      <span className='font-medium text-foreground'>৳{fmt(order?.total ?? 0)}</span>
                    </div>
                    {paid > 0 && (
                      <div className='flex justify-between items-center text-emerald-600 dark:text-emerald-400'>
                        <span>Paid (Advance):</span>
                        <span className='font-medium'>-৳{fmt(paid)}</span>
                      </div>
                    )}
                    <div className='flex justify-between items-center text-amber-600 dark:text-amber-500 font-bold pt-1 border-t border-border/50 text-sm'>
                      <span>COD to Collect by Courier:</span>
                      <span className='font-extrabold text-base'>৳{fmt(due)}</span>
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => { setShowDispatchDialog(false); setDispatchCourier('') }}>Cancel</Button>
              <Button disabled={!dispatchCourier || dispatchMut.isPending} onClick={() => dispatchMut.mutate({ courier: dispatchCourier, orderId: id })}>
                {dispatchMut.isPending ? <Loader2 className='h-4 w-4 animate-spin mr-1' /> : <Send className='h-4 w-4 mr-1' />}
                Dispatch
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Ledger entry modals (Task 11) ─────────────────────── */}
        <RecordPaymentModal
          orderId={id}
          open={showRecordPayment}
          onClose={() => setShowRecordPayment(false)}
          txnRequired={!staffAutoVerified}
        />
        <RecordRefundModal
          orderId={id}
          open={showRecordRefund}
          onClose={() => setShowRecordRefund(false)}
        />

        {/* ── Variant Picker Dialog ────────────────────────────── */}
        <Dialog open={!!selectedProductForVariants} onOpenChange={() => setSelectedProductForVariants(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Select Variant</DialogTitle></DialogHeader>
            <div className='space-y-3 py-2'>
              <p className='text-sm font-medium'>{selectedProductForVariants?.name}</p>
              <div className='space-y-2 max-h-60 overflow-y-auto'>
                {selectedProductForVariants?.variants?.map((v: any) => (
                  <div key={v.id} className='flex items-center justify-between p-2 border rounded-md hover:bg-muted cursor-pointer' onClick={() => {
                    setOrderItems([...orderItems, {
                      productId: selectedProductForVariants.id,
                      variantId: v.id,
                      product: { ...selectedProductForVariants, name: `${selectedProductForVariants.name} (${variantLabel(v)})` },
                      quantity: 1,
                      price: v.salePrice ?? v.price ?? selectedProductForVariants.salePrice ?? selectedProductForVariants.basePrice ?? 0,
                    }])
                    setSelectedProductForVariants(null)
                    setProductSearchQuery('')
                  }}>
                    <div className='flex items-center gap-2'>
                      {variantThumbUrl(v, selectedProductForVariants) ? (
                        <SafeImage src={mediaUrl(variantThumbUrl(v, selectedProductForVariants)!)} alt='' className='h-8 w-8 rounded border object-cover' thumbWidth={48} thumbHeight={48} />
                      ) : (
                        <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
                      )}
                      <div>
                        <p className='text-sm font-medium'>{variantLabel(v)}</p>
                        <p className='text-xs text-muted-foreground'>{v.sku || 'No SKU'}</p>
                      </div>
                    </div>
                    <div className='text-sm font-medium'>৳{fmt(v.salePrice ?? v.price ?? ep(selectedProductForVariants))}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className='flex justify-end'><Button variant='outline' onClick={() => setSelectedProductForVariants(null)}>Cancel</Button></div>
          </DialogContent>
        </Dialog>
      </>
    </TooltipProvider>
  )
}
