import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SafeImage } from '@/components/safe-image'
import { UserBadge } from '@/components/user-badge'
import { ordersApi, mediaUrl } from '@/features/orders/api'
import { CustomerViewCard } from '@/features/orders/customer-view-card'
import { OrderSummaryCard } from '@/features/orders/order-summary-card'
import { CustomerEditSheet } from '@/features/orders/customer-edit-sheet'
import { apiClient } from '@/lib/api-client'
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
import { PaymentLogo } from '@/components/payment-logo'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Separator } from '@/components/ui/separator'
import {
  Loader2, ArrowLeft, ArrowRight, Package, Pencil, Save, Clock, User, ChevronDown, ChevronUp,
  Truck, ExternalLink, Printer, Eye, EyeOff, MessageSquarePlus, ArrowRightLeft, Tag, Send,
  AlertTriangle, MoreHorizontal, Minus, Plus, X, MapPin, Mail, Phone, Trash2, RefreshCcw
} from 'lucide-react'
import { DISPATCH_STATUSES } from '@/features/dispatch/data/data'
import { STATUS_COLORS as statusColors } from '@/features/orders/status-transitions'

const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

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
  const { data: order, isLoading } = useQuery({ queryKey: ['order', id], queryFn: () => ordersApi.get(id).then(r => r.data) })

  const { data: statuses } = useQuery({ queryKey: ['order-statuses'], queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]) })
  const statusList = (Array.isArray(statuses) ? statuses : []) as any[]

  // ── Items edit state ──────────────────────────────────────────────
  const [editingItems, setEditingItems] = useState(false)
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any>(null)

  // ── Customer sheet state ──────────────────────────────────────────
  const [showCustomerSheet, setShowCustomerSheet] = useState(false)

  // ── Timeline / Notes ─────────────────────────────────────────────
  const [noteText, setNoteText] = useState('')
  const [noteVisibility, setNoteVisibility] = useState<'public' | 'private'>('public')
  const [showStatusDialog, setShowStatusDialog] = useState<string | null>(null)
  const [statusNote, setStatusNote] = useState('')

  // ── Collapsible sidebar panels ────────────────────────────────────
  const [showCustomerHistory, setShowCustomerHistory] = useState(false)
  const [showCourier, setShowCourier] = useState(false)

  // ── Dispatch ─────────────────────────────────────────────────────
  const [showDispatchDialog, setShowDispatchDialog] = useState(false)
  const [dispatchCourier, setDispatchCourier] = useState('')

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

  const phone = order?.customer?.phoneNumber?.replace(/[^\d]/g, '')
  const { data: customerSummary } = useQuery({ queryKey: ['customer-summary', phone], queryFn: () => apiClient.get(`/customers/order-summary?phone=${phone}`).then(r => r.data), enabled: !!phone })
  const { data: courierData, isLoading: courierLoading } = useQuery({ queryKey: ['courier-search', phone], queryFn: () => apiClient.get(`/courier/search?phone=${phone}`).then(r => r.data), enabled: showCourier && !!phone })

  // ── Effects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (order) setOrderItems(order.items || [])
  }, [order])

  useEffect(() => {
    if (editingItems) {
      apiClient.get('/products').then(r => setAllProducts(r.data?.data || r.data || [])).catch(() => toast.error('Failed to load products'))
    }
  }, [editingItems])

  // ── Mutations ─────────────────────────────────────────────────────
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.updateOrder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      toast.success('Updated')
    },
    onError: (e: unknown) => toast.error((e as Error).message || 'Update failed'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, statusId, note }: { id: string; statusId: string; note?: string }) => ordersApi.updateStatus(id, statusId, note),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['order', id] }); toast.success('Status updated') },
  })

  const noteMut = useMutation({
    mutationFn: ({ id, note, visibility }: { id: string; note: string; visibility: 'public' | 'private' }) => ordersApi.addNote(id, note, visibility),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['order', id] }); toast.success('Note added') },
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
    onError: (e: unknown) => toast.error((e as Error).message || 'Dispatch failed'),
  })

  const trashMut = useMutation({
    mutationFn: (orderId: string) => ordersApi.trash(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Order moved to trash')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Failed'),
  })

  const restoreMut = useMutation({
    mutationFn: (orderId: string) => ordersApi.restore(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Order restored from trash')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Failed'),
  })

  // ── Handlers ──────────────────────────────────────────────────────
  function handleSaveItems() {
    updateMut.mutate({
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
    setEditingItems(false)
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

        <Main className='flex flex-1 flex-col gap-4'>

          {/* ── Page Header ──────────────────────────────────────── */}
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
            <div>
              <h2 className='text-xl font-bold tracking-tight'>
                {order.displayId}
                {order.trashedAt && (
                  <Badge variant='destructive' className='ml-2 align-middle text-xs'>
                    <Trash2 className='h-3 w-3 mr-1 inline' /> Trashed
                  </Badge>
                )}
              </h2>
              <p className='text-xs text-muted-foreground'>{new Date(order.createdAt).toLocaleString()}</p>
            </div>

            {order.trashedAt && (
              <div className='col-span-full rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive'>
                <AlertTriangle className='h-4 w-4 inline mr-1.5 -mt-0.5' />
                This order is in trash. It was moved to trash on {new Date(order.trashedAt).toLocaleString()}.
                It is excluded from all reports, stats, and listings.
              </div>
            )}

            <div className='flex items-center gap-2 flex-wrap'>
              {/* Status Badge + Courier Status */}
              <div className='flex items-center gap-1.5 border rounded-md px-2.5 py-1'>
                <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }} className='text-xs'>
                  {order.status.name}
                </Badge>
                {order.dispatches && order.dispatches.length > 0 && (() => {
                  const latestDispatch = order.dispatches[order.dispatches.length - 1]
                  const ds = DISPATCH_STATUSES.find(d => d.value === latestDispatch.status)
                  return (
                    <Badge variant='outline' className={`text-xs flex items-center gap-1 ${ds?.color ? ds.color.replace('bg-', 'text-').replace('-500', '-600') : ''}`}>
                      <Truck className='h-3 w-3' />{ds?.label || latestDispatch.status}
                    </Badge>
                  )
                })()}
                {order.trackingUrl && (
                  <Button size='icon' variant='ghost' className='h-6 w-6' title='Track' onClick={() => window.open(order.trackingUrl!, '_blank')}>
                    <ExternalLink className='h-3 w-3' />
                  </Button>
                )}
              </div>

              {/* Next-status: on mobile collapse to a single dropdown; on sm+ show pills */}
              {allowedStatuses.length > 0 && (
                <>
                  {/* Mobile: all in dropdown */}
                  <div className='sm:hidden'>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='outline' size='sm' className='h-8 text-xs gap-1'>
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
                  {/* Desktop: pill buttons */}
                  <div className='hidden sm:flex items-center gap-1'>
                    {allowedStatuses.slice(0, 3).map((s: any) => (
                      <Button
                        key={s.id}
                        variant='outline'
                        size='sm'
                        className='h-7 text-xs px-2.5'
                        style={{ borderColor: statusColors[s.name] || undefined, color: statusColors[s.name] || undefined }}
                        onClick={() => setShowStatusDialog(s.id)}
                      >
                        → {s.name}
                      </Button>
                    ))}
                    {allowedStatuses.length > 3 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='outline' size='sm' className='h-7 text-xs px-2'>
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

              {/* Dispatch button */}
              {!order.courierService && (
                <Button variant='default' size='sm' className='h-8' onClick={() => setShowDispatchDialog(true)}>
                  <Send className='h-3.5 w-3.5 mr-1' />
                  <span className='hidden xs:inline'>Send to Courier</span>
                  <span className='xs:hidden'>Dispatch</span>
                </Button>
              )}

              {/* More actions: Print */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='sm' className='h-8 px-2.5'>
                    <MoreHorizontal className='h-4 w-4' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
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

          {/* ── Main Grid ────────────────────────────────────────── */}
          <div className='grid grid-cols-1 lg:grid-cols-3 gap-5'>

            {/* ════ LEFT COLUMN ════ */}
            <div className='lg:col-span-2 space-y-5'>

              {/* Items Card */}
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-semibold flex items-center justify-between'>
                    <span className='flex items-center gap-1.5'><Package className='h-4 w-4' /> Items</span>
                    {!editingItems ? (
                      <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={() => setEditingItems(true)}>
                        <Pencil className='h-3.5 w-3.5 mr-1' /> Edit Items
                      </Button>
                    ) : (
                      <div className='flex gap-1.5'>
                        <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={() => { setEditingItems(false); setOrderItems(order.items || []) }}>
                          <X className='h-3.5 w-3.5 mr-1' /> Cancel
                        </Button>
                        <Button size='sm' className='h-7 text-xs' onClick={handleSaveItems} disabled={updateMut.isPending}>
                          <Save className='h-3.5 w-3.5 mr-1' /> Save
                        </Button>
                      </div>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className='p-0'>
                  <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className='text-right w-28'>Price</TableHead>
                        <TableHead className='text-right w-24'>Qty</TableHead>
                        <TableHead className='text-right w-24'>Total</TableHead>
                        {editingItems && <TableHead className='w-10' />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(editingItems ? orderItems : order.items)?.map((item: any, index: number) => (
                        <TableRow key={item.id || index}>
                          <TableCell>
                            <div className='flex items-center gap-3'>
                              {item.product?.images && Array.isArray(item.product.images) && item.product.images[0] ? (
                                <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-10 w-10 rounded border object-cover flex-shrink-0' thumbWidth={48} thumbHeight={48} />
                              ) : (
                                <div className='h-10 w-10 rounded border bg-muted flex items-center justify-center flex-shrink-0'>
                                  <Package className='h-5 w-5 text-muted-foreground' />
                                </div>
                              )}
                              <div>
                                <span className='text-sm font-medium block'>{item.product?.name}</span>
                                {item.variant && item.variant.attributeValues?.length > 0 && (
                                  <span className='text-xs text-muted-foreground mt-0.5 block'>
                                    {item.variant.attributeValues.map((av: any) => av.attributeValue?.value).filter(Boolean).join(' / ')}
                                  </span>
                                )}
                                {item.variant?.sku && (
                                  <span className='text-[10px] text-muted-foreground/60 font-mono block'>SKU: {item.variant.sku}</span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className='text-right'>
                            {editingItems ? (
                              <Input type='number' value={item.price} onChange={e => {
                                const newItems = [...orderItems]
                                newItems[index].price = parseFloat(e.target.value) || 0
                                setOrderItems(newItems)
                              }} className='w-24 text-right h-8 text-sm ml-auto' />
                            ) : (
                              <span className='text-sm'>৳{fmt(item.price)}</span>
                            )}
                          </TableCell>
                          <TableCell className='text-right'>
                            {editingItems ? (
                              <div className='flex items-center justify-end gap-1'>
                                <Button variant='outline' size='icon' className='h-7 w-7' onClick={() => {
                                  const newItems = [...orderItems]
                                  newItems[index].quantity = Math.max(1, (newItems[index].quantity || 1) - 1)
                                  setOrderItems(newItems)
                                }}><Minus className='h-3 w-3' /></Button>
                                <span className='text-sm w-8 text-center font-medium'>{item.quantity}</span>
                                <Button variant='outline' size='icon' className='h-7 w-7' onClick={() => {
                                  const newItems = [...orderItems]
                                  newItems[index].quantity = (newItems[index].quantity || 1) + 1
                                  setOrderItems(newItems)
                                }}><Plus className='h-3 w-3' /></Button>
                              </div>
                            ) : (
                              <span className='text-sm'>{item.quantity}</span>
                            )}
                          </TableCell>
                          <TableCell className='text-right text-sm font-medium'>৳{fmt(nn(item.price) * item.quantity)}</TableCell>
                          {editingItems && (
                            <TableCell className='text-right'>
                              <Button variant='ghost' size='icon' className='h-7 w-7 text-destructive hover:text-destructive' onClick={() => setOrderItems(orderItems.filter((_, i) => i !== index))}>
                                <X className='h-3.5 w-3.5' />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}

                      {/* Add product search row */}
                      {editingItems && (
                        <TableRow>
                          <TableCell colSpan={5} className='p-2'>
                            <Command className='border rounded-md shadow-sm' shouldFilter={false}>
                              <CommandInput
                                placeholder='Search or scan product by name or SKU...'
                                value={productSearchQuery}
                                onValueChange={setProductSearchQuery}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    const exact = allProducts.find((p: any) => p.sku === productSearchQuery || p.variants?.some((v: any) => v.sku === productSearchQuery))
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
                                <CommandList className='max-h-48 overflow-y-auto'>
                                  <CommandEmpty>No results found.</CommandEmpty>
                                  <CommandGroup>
                                    {allProducts
                                      .filter((p: any) => p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) || p.sku?.toLowerCase().includes(productSearchQuery.toLowerCase()))
                                      .map((p: any) => (
                                        <CommandItem key={p.id} value={p.name} onSelect={() => {
                                          if (p.type === 'variable' || p.variants?.length > 0) {
                                            setSelectedProductForVariants(p)
                                          } else {
                                            setOrderItems([...orderItems, { productId: p.id, product: p, quantity: 1, price: p.salePrice ?? p.basePrice ?? 0 }])
                                            setProductSearchQuery('')
                                          }
                                        }} className='flex items-center gap-2 p-2 cursor-pointer'>
                                          {p.images && Array.isArray(p.images) && p.images[0] ? (
                                            <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-8 w-8 rounded border object-cover' thumbWidth={48} thumbHeight={48} />
                                          ) : (
                                            <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
                                          )}
                                          <div className='flex-1 min-w-0'>
                                            <p className='text-sm font-medium truncate'>{p.name}</p>
                                            <p className='text-xs text-muted-foreground'>{p.sku || 'No SKU'}</p>
                                          </div>
                                          <div className='text-sm font-medium'>৳{fmt(ep(p))}</div>
                                        </CommandItem>
                                      ))}
                                  </CommandGroup>
                                </CommandList>
                              )}
                            </Command>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Timeline Card */}
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-semibold flex items-center gap-1.5'><Clock className='h-4 w-4' /> Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  {!order.timeline || order.timeline.length === 0 ? (
                    <div className='text-center py-6 text-muted-foreground'>
                      <Clock className='h-7 w-7 mx-auto mb-2 opacity-40' />
                      <p className='text-sm'>No timeline entries yet.</p>
                    </div>
                  ) : (
                    <div className='space-y-0'>
                      {(order.timeline as any[]).map((t: any, i: number) => {
                        const isStatus = !!t.status && !t.type; const isPrivate = t.visibility === 'private'
                        const color = isStatus ? (statusColors[t.status] || '#6B7280') : isPrivate ? '#8B5CF6' : '#6366F1'
                        const prev = i > 0 ? (order.timeline as any[])[i - 1] : null
                        const prevIsStatus = !!prev?.status && !prev?.type
                        const isGrouped = prev && (t.type === prev.type || (isStatus && prevIsStatus))
                        const performer = t.performedBy || t.performer || ''
                        const performerEmail = performer.includes('@') ? performer : undefined
                        return (
                          <div key={i} className={`relative pl-6 pb-4 border-l-2 last:border-l-0 last:pb-0${isGrouped ? ' border-dashed' : ''}`} style={{ borderColor: color }}>
                            <div className='absolute left-0 top-1 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 bg-background' style={{ borderColor: color }} />
                            <div className='flex items-center gap-2 flex-wrap'>
                              {isStatus && t.oldStatus ? (
                                <div className='flex items-center gap-1.5'>
                                  <Badge variant='outline' className='text-xs'>{t.oldStatus}</Badge>
                                  <ArrowRight className='h-3 w-3 text-muted-foreground' />
                                  <Badge style={{ backgroundColor: color, color: '#fff' }} className='text-xs'>{t.status}</Badge>
                                </div>
                              ) : isStatus && <Badge style={{ backgroundColor: color, color: '#fff' }} className='text-xs'>{t.status}</Badge>}
                              {t.type === 'shipping' && <Badge variant='outline' className='text-xs'><ArrowRightLeft className='h-3 w-3 mr-1' />Shipping</Badge>}
                              {t.type === 'discount' && <Badge variant='outline' className='text-xs'><Tag className='h-3 w-3 mr-1' />Discount</Badge>}
                              {t.type === 'note' && <Badge variant='outline' className='text-xs'><MessageSquarePlus className='h-3 w-3 mr-1' />Note</Badge>}
                              {t.type === 'courier' && <Badge variant='outline' className='text-xs'><Truck className='h-3 w-3 mr-1' />{(t as any).courier}</Badge>}
                              {isPrivate && <Badge variant='secondary' className='text-xs'><EyeOff className='h-2.5 w-2.5 mr-0.5' />Private</Badge>}
                              {performer && performer !== 'System' && performer !== 'Customer' && <UserBadge email={performerEmail || performer} showEmail={false} size='sm' />}
                              {performer === 'System' && <Badge variant='secondary' className='text-[10px] h-4'>Auto</Badge>}
                              {performer === 'Customer' && <Badge variant='secondary' className='text-[10px] h-4'>Customer</Badge>}
                              <span className='text-xs text-muted-foreground'><Clock className='h-3 w-3 mr-1 inline' />{new Date(t.timestamp).toLocaleString()}</span>
                            </div>
                            {t.note && <p className='text-sm text-muted-foreground mt-1'>{t.note}</p>}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Add note — integrated in Timeline footer */}
                  <div className='mt-4 pt-3 border-t flex items-center gap-2'>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant='ghost' size='icon' className='h-7 w-7 shrink-0' onClick={() => setNoteVisibility(v => v === 'public' ? 'private' : 'public')}>
                          {noteVisibility === 'public' ? <Eye className='h-3.5 w-3.5' /> : <EyeOff className='h-3.5 w-3.5' />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{noteVisibility === 'public' ? 'Public note' : 'Private note'} — click to toggle</TooltipContent>
                    </Tooltip>
                    <Input
                      placeholder={`Add ${noteVisibility} note… (Enter to save)`}
                      className='text-sm h-8 flex-1'
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
                      size='sm' variant='outline' className='h-8 shrink-0'
                      disabled={!noteText.trim() || noteMut.isPending}
                      onClick={() => { if (noteText.trim()) { noteMut.mutate({ id, note: noteText.trim(), visibility: noteVisibility }); setNoteText('') } }}
                    >
                      {noteMut.isPending ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <MessageSquarePlus className='h-3.5 w-3.5' />}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Dispatch History */}
              {order.dispatches && order.dispatches.length > 0 && (
                <Card>
                  <CardHeader className='pb-2'>
                    <CardTitle className='text-sm font-semibold flex items-center gap-1.5'><Truck className='h-4 w-4' /> Dispatch History</CardTitle>
                  </CardHeader>
                  <CardContent className='p-0'>
                    <div className='overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Courier</TableHead>
                          <TableHead>Consignment ID</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Tracking</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {order.dispatches.slice().reverse().map((d: any) => {
                          const statusConfig = DISPATCH_STATUSES.find(s => s.value === d.status)
                          return (
                            <TableRow key={d.id}>
                              <TableCell className='font-medium text-sm capitalize'>{d.courier}</TableCell>
                              <TableCell className='text-sm font-mono'>{d.consignmentId}</TableCell>
                              <TableCell>
                                <Badge className={`text-xs ${statusConfig?.color || 'bg-gray-500'}`}>{statusConfig?.label || d.status}</Badge>
                              </TableCell>
                              <TableCell className='text-sm'>{d.trackingCode || '—'}</TableCell>
                              <TableCell className='text-xs text-muted-foreground'>{new Date(d.createdAt).toLocaleString()}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ════ RIGHT COLUMN (1/3) ════ */}
            <div className='space-y-4'>

              {/* Order Summary — inline editable */}
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
                onSaveShipping={handleSaveShipping}
                onSaveDiscount={handleSaveDiscount}
                isSaving={updateMut.isPending}
              />

              {/* Customer Card */}
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-semibold flex items-center justify-between'>
                    <span className='flex items-center gap-1.5'><User className='h-3.5 w-3.5' /> Customer</span>
                    <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={() => setShowCustomerSheet(true)}>
                      <Pencil className='h-3 w-3 mr-1' /> Edit
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-2 text-sm pt-0'>
                  <div>
                    <p className='font-medium'>
                      {order.customer ? `${order.customer.firstName} ${order.customer.lastName}` : (order.guestName || 'Guest')}
                    </p>
                    {(order.customer?.email || order.guestPhone) && (
                      <p className='text-muted-foreground text-xs flex items-center gap-1 mt-0.5'>
                        <Mail className='h-3 w-3' />{order.customer?.email || `${order.guestPhone}`}
                      </p>
                    )}
                    {(order.customer?.phoneNumber) && (
                      <p className='text-muted-foreground text-xs flex items-center gap-1 mt-0.5'>
                        <Phone className='h-3 w-3' />{order.customer.phoneNumber}
                      </p>
                    )}
                  </div>
                  {order.shippingAddress && (
                    <>
                      <Separator />
                      <div className='text-xs text-muted-foreground space-y-0.5'>
                        {(order.shippingAddress.address || order.shippingAddress.addressLine) && (
                          <p className='flex items-start gap-1.5'>
                            <MapPin className='h-3 w-3 mt-0.5 shrink-0' />
                            <span>{order.shippingAddress.address || order.shippingAddress.addressLine}</span>
                          </p>
                        )}
                        {(order.shippingAddress.city || order.shippingAddress.zone) && (
                          <p className='ml-5'>
                            {[order.shippingAddress.zone?.name || order.shippingAddress.zone, order.shippingAddress.city?.name || order.shippingAddress.city].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                  {(order.customerNotes || order.officeNotes) && (
                    <>
                      <Separator />
                      <div className='space-y-1'>
                        {order.customerNotes && (
                          <div className='bg-muted/50 rounded p-2 text-xs'>
                            <p className='text-muted-foreground mb-0.5 font-medium'>Customer Note</p>
                            <p>{order.customerNotes}</p>
                          </div>
                        )}
                        {order.officeNotes && (
                          <div className='bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-2 text-xs'>
                            <p className='text-amber-700 dark:text-amber-400 mb-0.5 font-medium'>Office Note</p>
                            <p>{order.officeNotes}</p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Payment Cards */}
              {order.paymentOptionType && (
                <Card>
                  <CardHeader className='pb-2'>
                    <CardTitle className='text-sm font-semibold flex items-center gap-2'>
                      Payment <PaymentStatusBadge status={order.paymentStatus} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-1 text-sm pt-0'>
                    <p><span className='text-muted-foreground'>Method:</span> {paymentOptionTypeLabel(order.paymentOptionType)}</p>
                    {order.partialAmount && <p><span className='text-muted-foreground'>Partial:</span> ৳{fmt(order.partialAmount)}</p>}
                  </CardContent>
                </Card>
              )}
              {order.payments?.map((p: any) => {
                const ps = p.status?.toLowerCase()
                const statusVariant = ps === 'paid' || ps === 'verified' || ps === 'completed' ? 'default' as const : ps === 'pending' || ps === 'payment_pending' ? 'secondary' as const : ps === 'failed' || ps === 'cancelled' ? 'destructive' as const : 'outline' as const
                return (
                  <Card key={p.id}>
                    <CardHeader className='pb-2'>
                      <CardTitle className='text-sm flex items-center justify-between'>
                        <PaymentLogo method={p.gatewayCode || p.method} size='sm' />
                        <Badge variant={statusVariant} className='text-xs'>{p.status}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-1 text-sm pt-0'>
                      <p>Amount: ৳{fmt(p.amount)}</p>
                      {p.transactionId && <p>TrxID: <span className='font-mono text-xs'>{p.transactionId}</span></p>}
                      {p.gatewayCode && <p className='text-xs text-muted-foreground'>Gateway: {p.gatewayCode}</p>}
                    </CardContent>
                  </Card>
                )
              })}

              {order.shipment && (
                <Card>
                  <CardHeader className='pb-2'><CardTitle className='text-sm font-semibold'>Shipment</CardTitle></CardHeader>
                  <CardContent className='space-y-1 text-sm pt-0'>
                    <p>Courier: {order.shipment.courier}</p>
                    <p>Tracking: {order.shipment.trackingNo}</p>
                  </CardContent>
                </Card>
              )}

              {/* Customer View Link */}
              <CustomerViewCard order={order} />

              {/* Customer Order History */}
              <Card>
                <CardHeader className='pb-2 cursor-pointer' onClick={() => setShowCustomerHistory(!showCustomerHistory)}>
                  <CardTitle className='text-sm font-semibold flex items-center justify-between'>
                    <span className='flex items-center gap-1.5'><User className='h-3.5 w-3.5' /> Customer History</span>
                    {showCustomerHistory ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                  </CardTitle>
                </CardHeader>
                {showCustomerHistory && customerSummary?.customer ? (
                  <CardContent className='pt-0'>
                    <div className='grid grid-cols-2 gap-2 text-sm'>
                      <div className='bg-muted/50 rounded p-2 text-center'>
                        <p className='text-lg font-bold'>{customerSummary.summary.totalOrders}</p>
                        <p className='text-xs text-muted-foreground'>Orders</p>
                      </div>
                      <div className='bg-muted/50 rounded p-2 text-center'>
                        <p className='text-lg font-bold'>৳{nn(customerSummary.summary.totalSpent).toFixed(0)}</p>
                        <p className='text-xs text-muted-foreground'>Spent</p>
                      </div>
                    </div>
                  </CardContent>
                ) : showCustomerHistory && (
                  <CardContent className='pt-0'><p className='text-xs text-muted-foreground'>No history</p></CardContent>
                )}
              </Card>

              {/* Courier Delivery Rate */}
              <Card>
                <CardHeader className='pb-2 cursor-pointer' onClick={() => setShowCourier(!showCourier)}>
                  <CardTitle className='text-sm font-semibold flex items-center justify-between'>
                    <span className='flex items-center gap-1.5'><Truck className='h-3.5 w-3.5' /> Courier History</span>
                    {showCourier ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                  </CardTitle>
                </CardHeader>
                {showCourier && (() => {
                  if (courierLoading) return <CardContent><Loader2 className='animate-spin h-4 w-4' /></CardContent>
                  const isDummy = !!courierData?.error
                  const summariesToUse = isDummy ? {
                    'Steadfast (Dummy)': { 'Total Parcels': 15, 'Delivered Parcels': 12, 'Canceled Parcels': 3 },
                    'Pathao (Dummy)': { 'Total Delivery': 8, 'Successful Delivery': 5, 'Canceled Delivery': 3 },
                    'RedX (Dummy)': { 'Total Parcels': 22, 'Delivered Parcels': 15, 'Canceled Parcels': 7 },
                  } : courierData?.Summaries
                  if (!summariesToUse) return <CardContent><p className='text-xs text-muted-foreground'>No data</p></CardContent>
                  const entries = Object.entries(summariesToUse as Record<string, any>)
                  let overallDelivered = 0; let overallCancelled = 0; let overallTotal = 0
                  entries.forEach(([, stats]) => {
                    overallDelivered += (stats['Delivered Parcels'] || stats['Successful Delivery'] || 0)
                    overallCancelled += (stats['Canceled Parcels'] || stats['Canceled Delivery'] || 0)
                    overallTotal += (stats['Total Parcels'] || stats['Total Delivery'] || 0)
                  })
                  const successRate = overallTotal > 0 ? Math.round((overallDelivered / overallTotal) * 100) : 0
                  const failRate = overallTotal > 0 ? Math.round((overallCancelled / overallTotal) * 100) : 0
                  return (
                    <CardContent className='pt-0 space-y-3 text-sm'>
                      {isDummy && (
                        <div className='bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 text-xs px-2 py-1.5 rounded-md flex items-center gap-1.5'>
                          <AlertTriangle className='h-3.5 w-3.5 shrink-0' /> Demo data
                        </div>
                      )}
                      <div className='space-y-1'>
                        <div className='flex justify-between text-xs font-medium'>
                          <span className='text-emerald-600'>{successRate}% delivered</span>
                          <span className='text-red-500'>{failRate}% cancelled</span>
                        </div>
                        <div className='h-2 w-full rounded-full bg-muted overflow-hidden flex'>
                          <div className='h-full bg-emerald-500 transition-all' style={{ width: `${successRate}%` }} />
                          <div className='h-full bg-red-500 transition-all' style={{ width: `${failRate}%` }} />
                        </div>
                        <p className='text-xs text-muted-foreground text-center'>{overallTotal} total parcels</p>
                      </div>
                      <div className='space-y-1'>
                        {entries.map(([name, stats]) => {
                          const d = stats['Delivered Parcels'] || stats['Successful Delivery'] || 0
                          const c = stats['Canceled Parcels'] || stats['Canceled Delivery'] || 0
                          return (
                            <div key={name} className='flex items-center justify-between text-xs bg-muted/40 rounded px-2 py-1'>
                              <span className='font-medium'>{name.replace(' (Dummy)', '')}</span>
                              <div className='flex items-center gap-1'>
                                <span className='text-emerald-600 font-bold'>{d}</span>
                                <span className='text-muted-foreground'>/</span>
                                <span className='text-red-500 font-bold'>{c}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  )
                })()}
              </Card>
            </div>
          </div>
        </Main>

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
              <Button onClick={() => { statusMut.mutate({ id, statusId: showStatusDialog!, note: statusNote || undefined }); setShowStatusDialog(null); setStatusNote('') }}>Confirm</Button>
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
                      product: { ...selectedProductForVariants, name: `${selectedProductForVariants.name} (${v.name || v.sku})` },
                      quantity: 1,
                      price: v.salePrice ?? v.price ?? selectedProductForVariants.salePrice ?? selectedProductForVariants.basePrice ?? 0,
                    }])
                    setSelectedProductForVariants(null)
                    setProductSearchQuery('')
                  }}>
                    <div className='flex items-center gap-2'>
                      {v.image ? (
                        <SafeImage src={mediaUrl(v.image)} alt='' className='h-8 w-8 rounded border object-cover' thumbWidth={48} thumbHeight={48} />
                      ) : (
                        <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
                      )}
                      <div>
                        <p className='text-sm font-medium'>{v.name || 'Default Variant'}</p>
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
