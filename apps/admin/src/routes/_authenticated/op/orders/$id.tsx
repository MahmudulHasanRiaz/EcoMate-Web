import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SafeImage } from '@/components/safe-image'
import { UserBadge } from '@/components/user-badge'
import { ordersApi, mediaUrl } from '@/features/orders/api'
import { CustomerViewCard } from '@/features/orders/customer-view-card'
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
import { PaymentLogo } from '@/components/payment-logo'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Loader2, ArrowLeft, ArrowRight, Package, Pencil, Percent, DollarSign, Save, Clock, User, ChevronDown, ChevronUp, Truck, ExternalLink, Printer, Eye, EyeOff, MessageSquarePlus, ArrowRightLeft, Tag, Send, AlertTriangle } from 'lucide-react'

const statusColors: Record<string, string> = { Pending: '#F59E0B', Confirmed: '#3B82F6', Cancelled: '#EF4444', 'On Hold': '#8B5CF6', Packed: '#06B6D4', Shipped: '#10B981', 'In Courier': '#6366F1', Delivered: '#22C55E', 'Partial Return': '#F97316', 'Return Pending': '#EC4899', Returned: '#DC2626', Damaged: '#991B1B' }
const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

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

  const [editing, setEditing] = useState(false)
  const [shippingCharge, setShippingCharge] = useState('')
  const [selectedShippingOptionId, setSelectedShippingOptionId] = useState('')
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState('flat')
  const [customerNotes, setCustomerNotes] = useState('')
  const [officeNotes, setOfficeNotes] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [showStatusDialog, setShowStatusDialog] = useState<string | null>(null)
  const [showCustomerInfo, setShowCustomerInfo] = useState(false)
  const [showCourier, setShowCourier] = useState(false)
  const [noteVisibility, setNoteVisibility] = useState<'public' | 'private'>('public')
  const [showDispatchDialog, setShowDispatchDialog] = useState(false)
  const [dispatchCourier, setDispatchCourier] = useState('')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState('')
  const [cityId, setCityId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [cities, setCities] = useState<any[]>([])
  const [zones, setZones] = useState<any[]>([])
  const [orderItems, setOrderItems] = useState<any[]>([])
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<any>(null)

  const { data: courierCreds } = useQuery({ queryKey: ['courier-creds'], queryFn: () => apiClient.get('/couriers/credentials').then(r => r.data as any[]), enabled: showDispatchDialog })
  const activeCouriers = (Array.isArray(courierCreds) ? courierCreds : []).filter((c: any) => c.enabled)

  const { data: shippingOptions } = useQuery({
    queryKey: ['shipping-options'],
    queryFn: () => apiClient.get('/shipping/options').then(r => (r.data as any[]).filter((o: any) => o.isActive)),
    enabled: editing,
  })

  const { data: sysSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => apiClient.get('/system-settings').then(r => r.data),
    enabled: editing,
  })

  const shippingMode = sysSettings?.['shipping_mode'] || 'auto_district'

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
    onError: (e: unknown) => { toast.error((e as Error).message || 'Dispatch failed') },
  })

  useEffect(() => {
    if (order) {
      setShippingCharge(String(nn(order.shippingCharge)))
      setSelectedShippingOptionId(order.selectedShippingOptionId || '')
      setDiscount(String(nn(order.discount)))
      setDiscountType(order.discountType || 'flat')
      setCustomerNotes(order.customerNotes || '')
      setOfficeNotes(order.officeNotes || '')
      setFirstName(order.customer?.firstName || '')
      setLastName(order.customer?.lastName || '')
      setEmail(order.customer?.email || '')
      setCustomerPhone(order.customer?.phoneNumber || '')
      setAddress(order.shippingAddress?.address || '')
      setCityId(order.shippingAddress?.cityId || '')
      setZoneId(order.shippingAddress?.zoneId || '')
      setOrderItems(order.items || [])
    }
  }, [order])

  useEffect(() => {
    if (editing) {
      apiClient.get('/couriers/cities').then(r => setCities(r.data as any[])).catch(() => toast.error('Failed to fetch cities'))
      apiClient.get('/products').then(r => setAllProducts(r.data?.data || r.data || [])).catch(() => toast.error('Failed to load products'))
    }
  }, [editing])

  useEffect(() => {
    if (cityId) {
      apiClient.get(`/couriers/zones?cityId=${cityId}`).then(r => setZones(r.data as any[])).catch(() => toast.error('Failed to fetch zones'))
    }
  }, [cityId])

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.updateOrder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      setEditing(false)
      toast.success('Updated')
    },
  })

  const statusMut = useMutation({
    mutationFn: ({ id, statusId, note }: { id: string; statusId: string; note?: string }) => ordersApi.updateStatus(id, statusId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      toast.success('Status updated')
    },
  })

  const noteMut = useMutation({
    mutationFn: ({ id, note, visibility }: { id: string; note: string; visibility: 'public' | 'private' }) => ordersApi.addNote(id, note, visibility),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] })
      toast.success('Note added')
    },
  })

  const phone = order?.customer?.phoneNumber?.replace(/[^\d]/g, '')
  const { data: customerSummary } = useQuery({ queryKey: ['customer-summary', phone], queryFn: () => apiClient.get(`/customers/order-summary?phone=${phone}`).then(r => r.data), enabled: !!phone })
  const { data: courierData, isLoading: courierLoading } = useQuery({ queryKey: ['courier-search', phone], queryFn: () => apiClient.get(`/courier/search?phone=${phone}`).then(r => r.data), enabled: showCourier && !!phone })

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>
  if (!order) return <div className='p-6 text-muted-foreground'>Order not found</div>

  const allowedStatuses = ((order.status.nextStatuses as string[]) || []).map((sid: string) => statusList.find((s: any) => s.id === sid)).filter(Boolean)
  const handleSaveEdit = () => {
    updateMut.mutate({
      id,
      data: {
        shippingCharge: parseFloat(shippingCharge) || 0,
        selectedShippingOptionId: selectedShippingOptionId || null,
        discount: parseFloat(discount) || 0,
        discountType,
        customerNotes: customerNotes || null,
        officeNotes: officeNotes || null,
        customerInfo: {
          firstName,
          lastName,
          email,
          phoneNumber: customerPhone,
        },
        shippingAddress: {
          address,
          cityId,
          zoneId,
        },
        items: orderItems.map((i: any) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          price: i.price,
        })),
      }
    })
  }

  const rawDiscount = parseFloat(discount) || 0
  const itemSubtotal = (editing ? orderItems : order.items)?.reduce((s: number, i: any) => s + nn(i.price) * i.quantity, 0) || 0
  const effectiveDiscount = discountType === 'percentage' ? itemSubtotal * (rawDiscount / 100) : rawDiscount
  const calculatedTotal = Math.max(0, itemSubtotal + (parseFloat(shippingCharge) || 0) - effectiveDiscount)

  return (
    <>
      <Header fixed><Link to='/op/orders' className='me-auto'><Button variant='ghost'><ArrowLeft className='h-4 w-4 mr-1' /> Back</Button></Link><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between gap-4'>
          <div><h2 className='text-2xl font-bold tracking-tight'>{order.displayId}</h2><p className='text-muted-foreground'>{new Date(order.createdAt).toLocaleString()}</p></div>
          <div className='flex items-center gap-2'>
            {!editing && <Button variant='outline' size='sm' onClick={() => setEditing(true)}><Pencil className='h-4 w-4 mr-1' /> Edit</Button>}
            <Button variant='outline' size='sm' onClick={() => window.open(`/admin/op/print/sticker/${order.id}`, '_blank')}><Printer className='h-4 w-4 mr-1' /> Sticker</Button>
            <Button variant='outline' size='sm' onClick={() => window.open(`/admin/op/print/invoice/${order.id}`, '_blank')}><Printer className='h-4 w-4 mr-1' /> Invoice</Button>
            {!order.courierService && (
              <Button variant='default' size='sm' onClick={() => setShowDispatchDialog(true)}><Send className='h-4 w-4 mr-1' /> Send to Courier</Button>
            )}
            <div className='flex items-center gap-2 border rounded-md px-3 py-1.5'>
              <div className='flex items-center gap-1.5'>
                <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }}>{order.status.name}</Badge>
                {order.courierService && order.courierStatus && <Badge variant='outline' className='text-xs flex items-center gap-1'><Truck className='h-3 w-3' /> {order.courierStatus}</Badge>}
                {order.trackingUrl && <Button size='icon' variant='ghost' className='h-6 w-6' title='Track' onClick={() => window.open(order.trackingUrl!, '_blank')}><ExternalLink className='h-3 w-3' /></Button>}
              </div>
              {allowedStatuses.length > 0 && (
                <select className='text-sm border-0 bg-transparent focus:outline-none' value='' onChange={e => { if (e.target.value) setShowStatusDialog(e.target.value) }}>
                  <option value=''>Change...</option>
                  {allowedStatuses.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>

        <div className='grid grid-cols-3 gap-6'>
          <div className='col-span-2 space-y-6'>
            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Items</CardTitle></CardHeader>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className='text-right'>Price</TableHead><TableHead className='text-right'>Qty</TableHead><TableHead className='text-right'>Total</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(editing ? orderItems : order.items)?.map((item: any, index: number) => (
                      <TableRow key={item.id || index}>
                        <TableCell><div className='flex items-center gap-3'>{item.product?.images && Array.isArray(item.product.images) && item.product.images[0] ? <SafeImage src={mediaUrl(item.product.images[0])} alt='' className='h-10 w-10 rounded border object-cover' thumbWidth={48} thumbHeight={48} /> : <div className='h-10 w-10 rounded border bg-muted flex items-center justify-center'><Package className='h-5 w-5 text-muted-foreground' /></div>}<span className='text-sm font-medium'>{item.product?.name}</span></div></TableCell>
                        <TableCell className='text-right text-sm'>
                          {editing ? (
                            <Input type='number' value={item.price} onChange={e => {
                              const newItems = [...orderItems]
                              newItems[index].price = parseFloat(e.target.value) || 0
                              setOrderItems(newItems)
                            }} className='w-24 text-right h-8 text-sm' />
                          ) : (
                            `৳${fmt(item.price)}`
                          )}
                        </TableCell>
                        <TableCell className='text-right text-sm'>
                          {editing ? (
                            <Input type='number' value={item.quantity} onChange={e => {
                              const newItems = [...orderItems]
                              newItems[index].quantity = parseInt(e.target.value) || 1
                              setOrderItems(newItems)
                            }} className='w-20 text-right h-8 text-sm' />
                          ) : (
                            item.quantity
                          )}
                        </TableCell>
                        <TableCell className='text-right text-sm font-medium'>৳{fmt(nn(item.price) * item.quantity)}</TableCell>
                        {editing && (
                          <TableCell className='text-right'>
                            <Button variant='ghost' size='sm' className='h-7 text-xs text-destructive hover:text-destructive' onClick={() => {
                              setOrderItems(orderItems.filter((_, i) => i !== index))
                            }}>Remove</Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {editing && (
                      <TableRow>
                        <TableCell colSpan={5}>
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
                                    setOrderItems([...orderItems, { 
                                      productId: exact.id, 
                                      variantId: variant?.id,
                                      product: exact, 
                                      quantity: 1, 
                                      price: variant?.price || exact.price || 0 
                                    }])
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
                                    .filter((p: any) => 
                                      p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) || 
                                      p.sku?.toLowerCase().includes(productSearchQuery.toLowerCase())
                                    )
                                    .map((p: any) => (
                                      <CommandItem 
                                        key={p.id} 
                                        value={p.name}
                                        onSelect={() => {
                                          if (p.type === 'variable' || p.variants?.length > 0) {
                                            setSelectedProductForVariants(p)
                                          } else {
                                            setOrderItems([...orderItems, { productId: p.id, product: p, quantity: 1, price: p.price || 0 }])
                                            setProductSearchQuery('')
                                          }
                                        }}
                                        className='flex items-center gap-2 p-2 cursor-pointer'
                                      >
                                        {p.images && Array.isArray(p.images) && p.images[0] ? (
                                          <SafeImage src={mediaUrl(p.images[0])} alt='' className='h-8 w-8 rounded border object-cover' thumbWidth={48} thumbHeight={48} />
                                        ) : (
                                          <div className='h-8 w-8 rounded border bg-muted flex items-center justify-center'><Package className='h-4 w-4 text-muted-foreground' /></div>
                                        )}
                                        <div className='flex-1 min-w-0'>
                                          <p className='text-sm font-medium truncate'>{p.name}</p>
                                          <p className='text-xs text-muted-foreground'>{p.sku || 'No SKU'}</p>
                                        </div>
                                        <div className='text-sm font-medium'>৳{fmt(p.price)}</div>
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
                <div className='px-4 py-3 border-t space-y-1'>
                  <div className='flex justify-between text-sm'><span>Subtotal</span><span>৳{fmt(itemSubtotal)}</span></div>
                  <div className='flex justify-between text-sm'><span>Shipping</span><span>৳{fmt(order.shippingCharge)}</span></div>
                  {nn(order.discount) > 0 && <div className='flex justify-between text-sm text-green-600'><span>Discount ({order.discountType})</span><span>-৳{fmt(order.discount)}</span></div>}
                  <div className='flex justify-between font-bold text-base pt-1 border-t'><span>Total</span><span>৳{fmt(order.total)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Timeline</CardTitle></CardHeader>
              <CardContent>
                {!order.timeline || order.timeline.length === 0 ? (
                  <div className='text-center py-8 text-muted-foreground'>
                    <Clock className='h-8 w-8 mx-auto mb-2 opacity-40' />
                    <p className='text-sm'>No timeline entries yet.</p>
                  </div>
                ) : (
                <div className='space-y-0'>
                  {(order.timeline as any[]).map((t: any, i: number) => {
                    const isStatus = !!t.status && !t.type; const isPrivate = t.visibility === 'private';
                    const color = isStatus ? (statusColors[t.status] || '#6B7280') : isPrivate ? '#8B5CF6' : '#6366F1';
                    const prev = i > 0 ? (order.timeline as any[])[i - 1] : null;
                    const prevIsStatus = !!prev?.status && !prev?.type;
                    const isGrouped = prev && (t.type === prev.type || (isStatus && prevIsStatus));
                    const performer = t.performedBy || t.performer || '';
                    const performerEmail = performer.includes('@') ? performer : undefined;
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
                          {performer && performer !== 'System' && performer !== 'Customer' && <UserBadge email={performerEmail || performer} showEmail={false} size="sm" />}
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
              </CardContent>
            </Card>

            {order.dispatchLogs && order.dispatchLogs.length > 0 && (
              <Card>
                <CardHeader className='pb-2'><CardTitle className='text-base flex items-center gap-2'><Truck className='h-4 w-4' /> Dispatch History</CardTitle></CardHeader>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader><TableRow><TableHead>Courier</TableHead><TableHead>Status</TableHead><TableHead>ID</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                    <TableBody>{order.dispatchLogs.map((log: any) => (
                      <TableRow key={log.id}><TableCell className='font-medium text-sm capitalize'>{log.courier}</TableCell><TableCell><Badge variant={log.status === 'success' ? 'default' : 'destructive'} className='text-xs'>{log.status}</Badge></TableCell><TableCell className='text-sm font-mono'>{log.consignmentId || log.trackingCode || '—'}</TableCell><TableCell className='text-xs text-muted-foreground'>{new Date(log.createdAt).toLocaleString()}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <div className='mt-4 pt-3 border-t flex items-center gap-2'>
              <Button variant='ghost' size='sm' className='text-xs' onClick={() => setNoteVisibility(v => v === 'public' ? 'private' : 'public')}>
                {noteVisibility === 'public' ? <Eye className='h-3 w-3 mr-1' /> : <EyeOff className='h-3 w-3 mr-1' />}{noteVisibility === 'public' ? 'Public' : 'Private'}
              </Button>
              <Input placeholder='Add note...' className='text-sm h-7' onKeyDown={e => { if (e.key === 'Enter') { noteMut.mutate({ id, note: (e.target as HTMLInputElement).value, visibility: noteVisibility }); (e.target as HTMLInputElement).value = '' } }} />
            </div>
          </div>

          <div className='space-y-6'>
            <CustomerViewCard order={order} />

            <Card><CardHeader className='pb-2'><CardTitle className='text-base'>Customer</CardTitle></CardHeader><CardContent className='space-y-1 text-sm'><p className='font-medium'>{order.customer ? `${order.customer.firstName} ${order.customer.lastName}` : (order.guestName || 'Guest')}</p><p className='text-muted-foreground'>{order.customer?.email || (order.guestPhone ? `Phone: ${order.guestPhone}` : '—')}</p><p className='text-muted-foreground'>{order.customer?.phoneNumber || ''}</p></CardContent></Card>

            <Card><CardHeader className='pb-2 cursor-pointer' onClick={() => setShowCustomerInfo(!showCustomerInfo)}><CardTitle className='text-base flex items-center justify-between'><span className='flex items-center gap-1.5'><User className='h-4 w-4' /> History</span>{showCustomerInfo ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}</CardTitle></CardHeader>
              {showCustomerInfo && customerSummary?.customer ? (
                <CardContent className='space-y-2 text-sm'>
                  <div className='grid grid-cols-2 gap-2'><div className='bg-muted/50 rounded p-2 text-center'><p className='text-lg font-bold'>{customerSummary.summary.totalOrders}</p><p className='text-xs text-muted-foreground'>Orders</p></div><div className='bg-muted/50 rounded p-2 text-center'><p className='text-lg font-bold'>৳{nn(customerSummary.summary.totalSpent).toFixed(0)}</p><p className='text-xs text-muted-foreground'>Spent</p></div></div>
                </CardContent>
              ) : showCustomerInfo && <CardContent><p className='text-xs text-muted-foreground'>No history</p></CardContent>}
            </Card>

            <Card><CardHeader className='pb-2 cursor-pointer' onClick={() => setShowCourier(!showCourier)}><CardTitle className='text-base flex items-center justify-between'><span className='flex items-center gap-1.5'><Truck className='h-4 w-4' /> Courier History</span>{showCourier ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}</CardTitle></CardHeader>
              {showCourier && (() => {
                if (courierLoading) return <CardContent><Loader2 className='animate-spin h-4 w-4' /></CardContent>;
                
                const isDummy = !!courierData?.error;
                const summariesToUse = isDummy ? {
                  "Steadfast (Dummy)": { "Total Parcels": 15, "Delivered Parcels": 12, "Canceled Parcels": 3 },
                  "Pathao (Dummy)": { "Total Delivery": 8, "Successful Delivery": 5, "Canceled Delivery": 3 },
                  "RedX (Dummy)": { "Total Parcels": 22, "Delivered Parcels": 15, "Canceled Parcels": 7 }
                } : courierData?.Summaries;

                if (summariesToUse) {
                  return (
                    <CardContent className='space-y-3 text-sm'>
                      {isDummy && (
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 text-xs px-3 py-2 rounded-md mb-2 flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 shrink-0" /> 
                          This is a dummy report for UI demonstration because the API is not connected. ({courierData?.error})
                        </div>
                      )}
                      <div className={`space-y-3 ${isDummy ? 'opacity-90' : ''}`}>
                        {(() => {
                          const entries = Object.entries(summariesToUse as Record<string, any>);
                          let overallDelivered = 0;
                          let overallCancelled = 0;
                          let overallTotal = 0;

                          entries.forEach(([, stats]) => {
                            overallDelivered += (stats['Delivered Parcels'] || stats['Successful Delivery'] || 0);
                            overallCancelled += (stats['Canceled Parcels'] || stats['Canceled Delivery'] || 0);
                            overallTotal += (stats['Total Parcels'] || stats['Total Delivery'] || 0);
                          });

                          const overallSuccessRate = overallTotal > 0 ? Math.round((overallDelivered / overallTotal) * 100) : 0;
                          const overallFailRate = overallTotal > 0 ? Math.round((overallCancelled / overallTotal) * 100) : 0;

                          return (
                            <div className='flex flex-col'>
                              <div className='flex items-center justify-between border-b border-border/50 pb-2.5 mb-3'>
                                <div className='font-bold text-sm uppercase tracking-wide text-foreground'>Overall Success Rate</div>
                                <div className='font-medium text-[11px] text-muted-foreground bg-background px-2 py-1 rounded border shadow-sm'>Total Parcels: <strong className='text-foreground'>{overallTotal}</strong></div>
                              </div>
                              
                              <div className='bg-muted/10 rounded-xl p-3 mb-4 border shadow-sm'>
                                <div className='space-y-1.5'>
                                  <div className='flex justify-between text-base font-black'>
                                    <span className='text-emerald-600 dark:text-emerald-500'>{overallSuccessRate}%</span>
                                    <span className='text-red-500'>{overallFailRate}%</span>
                                  </div>
                                  <div className='h-3 w-full rounded-full bg-muted overflow-hidden flex shadow-inner'>
                                    <div className='h-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-500' style={{ width: `${overallSuccessRate}%` }} />
                                    <div className='h-full bg-red-500 dark:bg-red-400 transition-all duration-500' style={{ width: `${overallFailRate}%` }} />
                                  </div>
                                  <div className='flex justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground pt-0.5'>
                                    <span>{overallDelivered} Delivered</span>
                                    <span>{overallCancelled} Cancelled</span>
                                  </div>
                                </div>
                              </div>

                              <div className='bg-muted/20 rounded-xl border p-3'>
                                <div className='text-xs font-bold text-muted-foreground mb-2.5 uppercase tracking-wide border-b border-border/50 pb-2'>Courier Breakdown</div>
                                <div className='flex flex-wrap gap-2'>
                                  {entries.map(([name, stats]) => {
                                    const delivered = stats['Delivered Parcels'] || stats['Successful Delivery'] || 0;
                                    const cancelled = stats['Canceled Parcels'] || stats['Canceled Delivery'] || 0;
                                    return (
                                      <div key={name} className='flex items-center gap-2 bg-background border px-2.5 py-1.5 rounded-lg shadow-sm text-xs w-full sm:w-auto flex-1 min-w-[150px] justify-between'>
                                        <span className='font-bold text-foreground'>{name.replace(' (Dummy)', '')}</span>
                                        <div className='flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded border'>
                                          <span className='text-emerald-600 dark:text-emerald-500 font-black' title='Delivered'>{delivered}</span>
                                          <span className='text-muted-foreground/30'>/</span>
                                          <span className='text-red-500 font-black' title='Cancelled'>{cancelled}</span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </CardContent>
                  )
                }
                return <CardContent><p className='text-xs text-muted-foreground'>No data</p></CardContent>
              })()}
            </Card>

            {editing ? (
              <Card><CardHeader className='pb-2'><CardTitle className='text-base flex items-center justify-between'>Edit <Button size='sm' onClick={handleSaveEdit}><Save className='h-3.5 w-3.5 mr-1' />Save</Button></CardTitle></CardHeader>
                <CardContent className='space-y-3'>
                  <div>
                    {shippingMode === 'options' && (shippingOptions?.length ?? 0) > 0 ? (
                      <div className="space-y-2">
                        <Label className='text-xs'>Shipping Option</Label>
                        <select
                          className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm'
                          value={selectedShippingOptionId}
                          onChange={e => {
                            const optId = e.target.value
                            setSelectedShippingOptionId(optId)
                            const opt = (shippingOptions as any[]).find(o => o.id === optId)
                            if (opt) setShippingCharge(String(opt.amount))
                          }}
                        >
                          <option value=''>Select option...</option>
                          {(shippingOptions as any[]).map((o: any) => (
                            <option key={o.id} value={o.id}>৳{o.amount} — {o.name}</option>
                          ))}
                        </select>
                        <div className="grid grid-cols-2 gap-3 mt-2">
                          <div><Label className='text-xs'>Amount (override)</Label><Input type='number' step='0.01' value={shippingCharge} onChange={e => setShippingCharge(e.target.value)} /></div>
                          <div><Label className='text-xs'>Discount</Label><Input type='number' step='0.01' value={discount} onChange={e => setDiscount(e.target.value)} /></div>
                        </div>
                        {selectedShippingOptionId && order.shippingChargeOverridden && (
                          <p className="text-xs text-amber-600 mt-1">Amount was manually overridden</p>
                        )}
                      </div>
                    ) : (
                      <div className='grid grid-cols-2 gap-3'>
                        <div><Label className='text-xs'>Shipping</Label><Input type='number' step='0.01' value={shippingCharge} onChange={e => setShippingCharge(e.target.value)} /></div>
                        <div><Label className='text-xs'>Discount</Label><Input type='number' step='0.01' value={discount} onChange={e => setDiscount(e.target.value)} /></div>
                      </div>
                    )}
                  </div>
                  <div className='flex gap-1 border rounded-md p-0.5 w-fit'><Button variant={discountType === 'flat' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('flat')}><DollarSign className='h-3 w-3 mr-1' />Flat</Button><Button variant={discountType === 'percentage' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('percentage')}><Percent className='h-3 w-3 mr-1' />%</Button></div>
                  <div className='bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm'><div className='flex justify-between'><span className='text-muted-foreground'>Subtotal</span><span>৳{fmt(itemSubtotal)}</span></div><div className='flex justify-between'><span className='text-muted-foreground'>Shipping</span><span>+৳{fmt(parseFloat(shippingCharge) || 0)}</span></div>{rawDiscount > 0 && <div className='flex justify-between text-green-600'><span className='text-muted-foreground'>Discount {discountType === 'percentage' ? `(${rawDiscount}%)` : ''}</span><span>-৳{fmt(effectiveDiscount)}</span></div>}<div className='flex justify-between font-bold text-base pt-1.5 border-t'><span>Total</span><span>৳{fmt(calculatedTotal)}</span></div></div>
                  
                  <div className='border-t pt-3 space-y-3'>
                    <h3 className='text-sm font-medium'>Customer Info</h3>
                    <div className='grid grid-cols-2 gap-3'>
                      <div><Label className='text-xs'>First Name</Label><Input value={firstName} onChange={e => setFirstName(e.target.value)} /></div>
                      <div><Label className='text-xs'>Last Name</Label><Input value={lastName} onChange={e => setLastName(e.target.value)} /></div>
                    </div>
                    <div><Label className='text-xs'>Email</Label><Input value={email} onChange={e => setEmail(e.target.value)} /></div>
                    <div><Label className='text-xs'>Phone</Label><Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} /></div>
                  </div>

                  <div className='border-t pt-3 space-y-3'>
                    <h3 className='text-sm font-medium'>Shipping Address</h3>
                    <div><Label className='text-xs'>Address</Label><Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} /></div>
                    <div>
                      <Label className='text-xs'>City</Label>
                      <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm' value={cityId} onChange={e => { setCityId(e.target.value); setZones([]); }}>
                        <option value=''>Select City...</option>
                        {cities.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className='text-xs'>Zone</Label>
                      <select className='w-full h-9 rounded-md border border-input bg-background px-3 text-sm' value={zoneId} onChange={e => setZoneId(e.target.value)}>
                        <option value=''>Select Zone...</option>
                        {zones.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className='border-t pt-3 space-y-3'>
                    <div><Label className='text-xs'>Customer Notes</Label><Textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} rows={2} /></div>
                    <div><Label className='text-xs'>Office Notes</Label><Textarea value={officeNotes} onChange={e => setOfficeNotes(e.target.value)} rows={2} /></div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card><CardHeader className='pb-2'><CardTitle className='text-base'>Details</CardTitle></CardHeader><CardContent className='space-y-2 text-sm'><div className='flex justify-between'><span className='text-muted-foreground'>Subtotal</span><span>৳{fmt(order.subtotal)}</span></div><div className='flex justify-between'><span className='text-muted-foreground'>Shipping</span><span>৳{fmt(order.shippingCharge)}</span></div>{nn(order.discount) > 0 && <div className='flex justify-between text-green-600'><span className='text-muted-foreground'>Discount ({order.discountType})</span><span>-৳{fmt(order.discount)}</span></div>}<div className='flex justify-between font-bold pt-1 border-t'><span>Total</span><span>৳{fmt(order.total)}</span></div></CardContent></Card>
                {order.shipment && <Card><CardHeader className='pb-2'><CardTitle className='text-base'>Shipment</CardTitle></CardHeader><CardContent className='space-y-1 text-sm'><p>Courier: {order.shipment.courier}</p><p>Tracking: {order.shipment.trackingNo}</p></CardContent></Card>}
                {order.paymentOptionType && (
                  <Card>
                    <CardHeader className='pb-2'><CardTitle className='text-base flex items-center gap-2'>Payment <PaymentStatusBadge status={order.paymentStatus} /></CardTitle></CardHeader>
                    <CardContent className='space-y-1 text-sm'>
                      <p><span className='text-muted-foreground'>Method:</span> {paymentOptionTypeLabel(order.paymentOptionType)}</p>
                      {order.partialAmount && <p><span className='text-muted-foreground'>Partial Amount:</span> ৳{fmt(order.partialAmount)}</p>}
                    </CardContent>
                  </Card>
                )}
                {order.payments?.map((p: any) => {
                  const ps = p.status?.toLowerCase()
                  const statusVariant = ps === 'paid' || ps === 'verified' || ps === 'completed' ? 'default' as const : ps === 'pending' || ps === 'payment_pending' ? 'secondary' as const : ps === 'failed' || ps === 'cancelled' ? 'destructive' as const : 'outline' as const
                  return (
                  <Card key={p.id}>
                    <CardHeader className='pb-2'>
                      <CardTitle className='text-base text-xs flex items-center justify-between'>
                        <PaymentLogo method={p.gatewayCode || p.method} size='sm' />
                        <Badge variant={statusVariant} className='text-xs'>{p.status}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-1 text-sm'>
                      <p>Amount: ৳{fmt(p.amount)}</p>
                      {p.transactionId && <p>TrxID: {p.transactionId}</p>}
                      {p.gatewayCode && <p className='text-xs text-muted-foreground'>Gateway: {p.gatewayCode}</p>}
                    </CardContent>
                  </Card>
                )})}
              </>
            )}
          </div>
        </div>
      </Main>
      <Dialog open={!!showStatusDialog} onOpenChange={() => setShowStatusDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>Change Status</DialogTitle></DialogHeader>
          <div className='space-y-3 py-2'>
            <p className='text-sm'>Current: <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }}>{order.status.name}</Badge></p>
            {showStatusDialog && <p className='text-sm'>New: <Badge style={{ backgroundColor: statusColors[statusList.find((s: any) => s.id === showStatusDialog)?.name] || '#6B7280', color: '#fff' }}>{statusList.find((s: any) => s.id === showStatusDialog)?.name}</Badge></p>}
            <div><Label>Note</Label><Textarea value={statusNote} onChange={e => setStatusNote(e.target.value)} rows={2} /></div>
          </div>
          <div className='flex justify-end gap-2'><Button variant='outline' onClick={() => { setShowStatusDialog(null); setStatusNote('') }}>Cancel</Button><Button onClick={() => { statusMut.mutate({ id, statusId: showStatusDialog!, note: statusNote || undefined }); setShowStatusDialog(null) }}>Confirm</Button></div>
        </DialogContent>
      </Dialog>
      <Dialog open={showDispatchDialog} onOpenChange={() => { setShowDispatchDialog(false); setDispatchCourier('') }}>
        <DialogContent><DialogHeader><DialogTitle>Send to Courier</DialogTitle></DialogHeader>
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
      <Dialog open={!!selectedProductForVariants} onOpenChange={() => setSelectedProductForVariants(null)}>
        <DialogContent><DialogHeader><DialogTitle>Select Variant</DialogTitle></DialogHeader>
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
                    price: v.price || selectedProductForVariants.price || 0 
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
                  <div className='text-sm font-medium'>৳{fmt(v.price || selectedProductForVariants.price)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className='flex justify-end'><Button variant='outline' onClick={() => setSelectedProductForVariants(null)}>Cancel</Button></div>
        </DialogContent>
      </Dialog>
    </>
  )
}
