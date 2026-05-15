import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ordersApi, mediaUrl, type OrderResponse } from './api'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ArrowLeft, Package, Pencil, Percent, DollarSign, Save, Clock, User, ChevronDown, ChevronUp, Truck, Eye, EyeOff, MessageSquarePlus, ArrowRightLeft, Tag, ShoppingBag, ExternalLink } from 'lucide-react'
import { PaymentLogo } from '@/components/payment-logo'
import type { PaginationState } from '@tanstack/react-table'

const statusColors: Record<string, string> = { Pending: '#F59E0B', Confirmed: '#3B82F6', Cancelled: '#EF4444', 'On Hold': '#8B5CF6', Packed: '#06B6D4', Shipped: '#10B981', 'In Courier': '#6366F1', Delivered: '#22C55E', 'Partial Return': '#F97316', 'Return Pending': '#EC4899', Returned: '#DC2626', Damaged: '#991B1B' }

function nn(v: number | string) { return Number(v) }
function fmt(v: number | string) { return nn(v).toFixed(2) }

export function Orders() {
  const queryClient = useQueryClient()
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [selected, setSelected] = useState<OrderResponse | null>(null)

  const { data: orderStatuses } = useQuery({ queryKey: ['order-statuses'], queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]) })

  const { data, isLoading } = useQuery({
    queryKey: ['orders', pagination], enabled: !selected,
    queryFn: () => ordersApi.list({ page: pagination.pageIndex + 1, perPage: pagination.pageSize }).then(r => r.data),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, statusId, note }: { id: string; statusId: string; note?: string }) => ordersApi.updateStatus(id, statusId, note),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      ordersApi.get(id).then(r => setSelected(r.data))
      toast.success('Status updated')
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => ordersApi.updateOrder(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      ordersApi.get(id).then(r => setSelected(r.data))
      toast.success('Order updated')
    },
  })

  if (selected) return <OrderDetail order={selected} onBack={() => { setSelected(null); queryClient.invalidateQueries({ queryKey: ['orders'] }) }} onUpdateStatus={(statusId, note) => statusMut.mutate({ id: selected.id, statusId, note })} onUpdate={(data) => updateMut.mutate({ id: selected.id, data })} statuses={orderStatuses || []} />

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div><h2 className='text-2xl font-bold tracking-tight'>Orders</h2><p className='text-muted-foreground'>Manage customer orders and track fulfillment.</p></div>
        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader><TableRow><TableHead>Order ID</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead className='text-right'>Total</TableHead><TableHead>Items</TableHead><TableHead>Date</TableHead><TableHead className='text-center'>Track</TableHead></TableRow></TableHeader>
            <TableBody>
               {isLoading ? <TableRow><TableCell colSpan={7} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
                data?.data?.length ? data.data.map(o => (
                 <TableRow key={o.id} className='cursor-pointer hover:bg-muted/50' onClick={() => setSelected(o)}>
                   <TableCell className='font-mono text-sm font-medium'>{o.displayId}</TableCell>
                   <TableCell><div className='text-sm font-medium'>{o.customer.firstName} {o.customer.lastName}</div><div className='text-xs text-muted-foreground'>{o.customer.phoneNumber}</div></TableCell>
                   <TableCell><Badge style={{ backgroundColor: statusColors[o.status.name] || '#6B7280', color: '#fff' }} className='text-xs'>{o.status.name}</Badge></TableCell>
                   <TableCell className='text-right font-medium'>৳{fmt(o.total)}</TableCell>
                   <TableCell>{o.items.length}</TableCell>
                   <TableCell className='text-xs text-muted-foreground'>{new Date(o.createdAt).toLocaleDateString()}</TableCell>
                   <TableCell className='text-center'>
                     {o.trackingUrl ? (
                       <Button size='icon' variant='ghost' className='h-7 w-7' title={`Track via ${o.courierService || 'Courier'}`} onClick={(e) => { e.stopPropagation(); window.open(o.trackingUrl!, '_blank') }}>
                         <ExternalLink className='h-3.5 w-3.5' />
                       </Button>
                     ) : <span className='text-xs text-muted-foreground'>—</span>}
                   </TableCell>
                 </TableRow>
               )) : <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>No orders yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
        {data?.meta && data.meta.totalPages > 1 && (
          <div className='flex items-center justify-between'>
            <span className='text-sm text-muted-foreground'>Page {pagination.pageIndex + 1} of {data.meta.totalPages}</span>
            <div className='flex gap-2'>
              <Button variant='outline' size='sm' disabled={pagination.pageIndex === 0} onClick={() => setPagination(p => ({ ...p, pageIndex: p.pageIndex - 1 }))}>Previous</Button>
              <Button variant='outline' size='sm' disabled={pagination.pageIndex + 1 >= data.meta.totalPages} onClick={() => setPagination(p => ({ ...p, pageIndex: p.pageIndex + 1 }))}>Next</Button>
            </div>
          </div>
        )}
      </Main>
    </>
  )
}

function OrderDetail({ order: initialOrder, onBack, onUpdateStatus, onUpdate, statuses }: { order: OrderResponse; onBack: () => void; onUpdateStatus: (s: string, n?: string) => void; onUpdate: (d: any) => void; statuses: any[] }) {
  const [order, setOrder] = useState(initialOrder)

  useEffect(() => { setOrder(initialOrder) }, [initialOrder])
  const [editing, setEditing] = useState(false)
  const [shippingCharge, setShippingCharge] = useState(String(nn(order.shippingCharge)))
  const [discount, setDiscount] = useState(String(nn(order.discount)))
  const [discountType, setDiscountType] = useState(order.discountType || 'flat')
  const [customerNotes, setCustomerNotes] = useState(order.customerNotes || '')
  const [officeNotes, setOfficeNotes] = useState(order.officeNotes || '')
  const [statusNote, setStatusNote] = useState('')
  const [showStatusDialog, setShowStatusDialog] = useState<string | null>(null)
  const [showCustomerInfo, setShowCustomerInfo] = useState(false)
  const [showCourier, setShowCourier] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [noteVisibility, setNoteVisibility] = useState<'public' | 'private'>('public')
  const [showAllTimeline, setShowAllTimeline] = useState(false)

  const noteMut = useMutation({
    mutationFn: ({ id, note, visibility }: { id: string; note: string; visibility: 'public' | 'private' }) => ordersApi.addNote(id, note, visibility),
    onSuccess: () => {
      ordersApi.get(order.id).then(r => setOrder(r.data))
      setNewNote('')
      toast.success('Note added')
    },
  })

  const phone = order.customer.phoneNumber?.replace(/[^\d]/g, '')

  const { data: customerSummary } = useQuery({
    queryKey: ['customer-summary', phone],
    queryFn: () => apiClient.get(`/customers/order-summary?phone=${phone}`).then(r => r.data),
    enabled: !!phone,
  })

  const { data: courierData, isLoading: courierLoading } = useQuery({
    queryKey: ['courier-search', phone],
    queryFn: () => apiClient.get(`/courier/search?phone=${phone}`).then(r => r.data),
    enabled: showCourier && !!phone,
  })

  const { data: courierSummary } = useQuery({
    queryKey: ['courier-summary', phone],
    queryFn: () => apiClient.get(`/courier/summary?phone=${phone}`).then(r => r.data),
    enabled: showCourier && !!phone,
  })

  const allowedStatuses = ((order.status.nextStatuses as string[]) || []).map(id => statuses.find((s: any) => s.id === id)).filter(Boolean)

  const handleSaveEdit = () => {
    const ship = parseFloat(shippingCharge) || 0
    const disc = parseFloat(discount) || 0
    onUpdate({ shippingCharge: ship, discount: disc, discountType, customerNotes: customerNotes || null, officeNotes: officeNotes || null })
    setEditing(false)
  }

  const itemSubtotal = order.items.reduce((s, i) => s + nn(i.price) * i.quantity, 0)

  const rawDiscount = parseFloat(discount) || 0
  const effectiveDiscount = discountType === 'percentage' ? itemSubtotal * (rawDiscount / 100) : rawDiscount
  const calculatedTotal = Math.max(0, itemSubtotal + (parseFloat(shippingCharge) || 0) - effectiveDiscount)

  return (
    <>
      <Header fixed>
        <Button variant='ghost' onClick={onBack} className='me-auto'><ArrowLeft className='h-4 w-4 mr-1' /> Back</Button>
        <ThemeSwitch /><ConfigDrawer /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>{order.displayId}</h2>
            <p className='text-muted-foreground'>{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <div className='flex items-center gap-2'>
            {!editing && <Button variant='outline' size='sm' onClick={() => setEditing(true)}><Pencil className='h-4 w-4 mr-1' /> Edit</Button>}
            <div className='flex items-center gap-2 border rounded-md px-3 py-1.5'>
              <div className='flex items-center gap-1.5'>
                <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }}>{order.status.name}</Badge>
                {order.courierService && order.courierStatus && (
                  <Badge variant='outline' className='text-xs flex items-center gap-1'><Truck className='h-3 w-3' /> {order.courierStatus}</Badge>
                )}
                {order.trackingUrl && (
                  <Button size='icon' variant='ghost' className='h-6 w-6' title='Track' onClick={() => window.open(order.trackingUrl!, '_blank')}>
                    <ExternalLink className='h-3 w-3' />
                  </Button>
                )}
              </div>
              {allowedStatuses.length > 0 && (
                <select
                  className='text-sm border-0 bg-transparent focus:outline-none'
                  value=''
                  onChange={e => { if (e.target.value) setShowStatusDialog(e.target.value) }}
                >
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
                    {order.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className='flex items-center gap-3'>
                            {item.product.images && Array.isArray(item.product.images) && item.product.images[0]
                              ? <img src={mediaUrl(item.product.images[0])} alt='' className='h-10 w-10 rounded border object-cover' />
                              : <div className='h-10 w-10 rounded border bg-muted flex items-center justify-center'><Package className='h-5 w-5 text-muted-foreground' /></div>
                            }
                            <span className='text-sm font-medium'>{item.product.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className='text-right text-sm'>৳{fmt(item.price)}</TableCell>
                        <TableCell className='text-right text-sm'>{item.quantity}</TableCell>
                        <TableCell className='text-right text-sm font-medium'>৳{fmt(nn(item.price) * item.quantity)}</TableCell>
                      </TableRow>
                    ))}
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
                <div className='space-y-0'>
                  {(order.timeline as any[]).slice(0, showAllTimeline ? undefined : 8).map((t: any, i: number) => {
                    const isStatus = !!t.status && !t.type
                    const isNote = t.type === 'note'
                    const isShipping = t.type === 'shipping'
                    const isDiscount = t.type === 'discount'
                    const isItems = t.type === 'items'
                    const isPrivate = t.visibility === 'private'
                    const color = isStatus ? (statusColors[t.status] || '#6B7280') : isPrivate ? '#8B5CF6' : '#6366F1'

                    return (
                      <div key={i} className='relative pl-6 pb-4 border-l-2 last:border-l-0 last:pb-0' style={{ borderColor: color }}>
                        <div className='absolute left-0 top-1 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 bg-background' style={{ borderColor: color }} />
                        <div className='flex items-center gap-2 flex-wrap'>
                          {isStatus && <Badge style={{ backgroundColor: color, color: '#fff' }} className='text-xs'>{t.status}</Badge>}
                          {isShipping && <Badge variant='outline' className='text-xs flex items-center gap-1'><ArrowRightLeft className='h-2.5 w-2.5' /> Shipping</Badge>}
                          {isDiscount && <Badge variant='outline' className='text-xs flex items-center gap-1'><Tag className='h-2.5 w-2.5' /> Discount</Badge>}
                          {isItems && <Badge variant='outline' className='text-xs flex items-center gap-1'><ShoppingBag className='h-2.5 w-2.5' /> Items</Badge>}
                          {isNote && <Badge variant='outline' className='text-xs flex items-center gap-1'><MessageSquarePlus className='h-2.5 w-2.5' /> Note</Badge>}
                          {isPrivate && <Badge variant='secondary' className='text-xs flex items-center gap-0.5'><EyeOff className='h-2.5 w-2.5' /> Private</Badge>}
                          {!isPrivate && isNote && <Badge variant='secondary' className='text-xs flex items-center gap-0.5 bg-green-500/10 text-green-600'><Eye className='h-2.5 w-2.5' /> Public</Badge>}
                          <span className='text-xs text-muted-foreground flex items-center gap-1'><Clock className='h-3 w-3' /> {new Date(t.timestamp).toLocaleString()}</span>
                        </div>
                        {t.note && (
                          <p className={`text-sm mt-1 ${isPrivate ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'}`}>
                            {isShipping && t.oldValue !== undefined && (
                              <span className='mr-1'>৳{fmt(t.oldValue)} → ৳{fmt(t.newValue)}</span>
                            )}
                            {isDiscount && t.oldValue !== undefined && (
                              <span className='mr-1'>৳{fmt(t.oldValue)} → ৳{fmt(t.newValue)} ({t.discountType})</span>
                            )}
                            {t.note}
                          </p>
                        )}
                      </div>
                    )
                  })}
                  {order.timeline && (order.timeline as any[]).length > 8 && (
                    <button onClick={() => setShowAllTimeline(!showAllTimeline)} className='text-xs text-primary hover:underline pl-6'>
                      {showAllTimeline ? 'Show less' : `Show all (${(order.timeline as any[]).length})`}
                    </button>
                  )}
                </div>

                <div className='mt-4 pt-3 border-t'>
                  <div className='flex items-center gap-2 mb-2'>
                    <div className='flex gap-0.5 border rounded-md p-0.5'>
                      <Button variant={noteVisibility === 'public' ? 'default' : 'ghost'} size='sm' className='h-6 text-xs' onClick={() => setNoteVisibility('public')}>
                        <Eye className='h-3 w-3 mr-1' /> Public
                      </Button>
                      <Button variant={noteVisibility === 'private' ? 'default' : 'ghost'} size='sm' className='h-6 text-xs' onClick={() => setNoteVisibility('private')}>
                        <EyeOff className='h-3 w-3 mr-1' /> Private
                      </Button>
                    </div>
                  </div>
                  <div className='flex gap-2'>
                    <Input
                      placeholder='Add a note...'
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && newNote.trim()) { noteMut.mutate({ id: order.id, note: newNote.trim(), visibility: noteVisibility }) } }}
                      className='text-sm'
                    />
                    <Button size='sm' disabled={!newNote.trim() || noteMut.isPending} onClick={() => noteMut.mutate({ id: order.id, note: newNote.trim(), visibility: noteVisibility })}>
                      <MessageSquarePlus className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {order.dispatchLogs && order.dispatchLogs.length > 0 && (
              <Card>
                <CardHeader className='pb-2'><CardTitle className='text-base flex items-center gap-2'><Truck className='h-4 w-4' /> Dispatch History</CardTitle></CardHeader>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader><TableRow><TableHead>Courier</TableHead><TableHead>Status</TableHead><TableHead>Consignment / Tracking</TableHead><TableHead>Date</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {order.dispatchLogs.map(log => {
                        const trackUrl = log.trackingCode ? `https://redx.com.bd/track-global-parcel/?trackingId=${encodeURIComponent(log.trackingCode)}` : ''
                        return (
                          <TableRow key={log.id}>
                            <TableCell className='font-medium text-sm capitalize'>{log.courier}</TableCell>
                            <TableCell><Badge variant={log.status === 'success' ? 'default' : 'destructive'} className='text-xs'>{log.status}</Badge></TableCell>
                            <TableCell className='text-sm font-mono'>{log.consignmentId || log.trackingCode || '—'}</TableCell>
                            <TableCell className='text-xs text-muted-foreground'>{new Date(log.createdAt).toLocaleString()}</TableCell>
                            <TableCell>
                              {(log.trackingCode || log.consignmentId) && (
                                <Button size='icon' variant='ghost' className='h-7 w-7' title='Track' onClick={() => window.open(trackUrl, '_blank')}>
                                  <ExternalLink className='h-3.5 w-3.5' />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>

          <div className='space-y-6'>
            <Card>
              <CardHeader className='pb-2'><CardTitle className='text-base'>Customer</CardTitle></CardHeader>
              <CardContent className='space-y-1 text-sm'>
                <p className='font-medium'>{order.customer.firstName} {order.customer.lastName}</p>
                <p className='text-muted-foreground'>{order.customer.email}</p>
                <p className='text-muted-foreground'>{order.customer.phoneNumber}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='pb-2 cursor-pointer' onClick={() => setShowCustomerInfo(!showCustomerInfo)}>
                <CardTitle className='text-base flex items-center justify-between'>
                  <span className='flex items-center gap-1.5'><User className='h-4 w-4' /> History</span>
                  {showCustomerInfo ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                </CardTitle>
              </CardHeader>
              {showCustomerInfo && (
                <CardContent className='space-y-2 text-sm'>
                  {customerSummary?.customer ? (
                    <>
                      <div className='grid grid-cols-2 gap-2'>
                        <div className='bg-muted/50 rounded p-2 text-center'><p className='text-lg font-bold'>{customerSummary.summary.totalOrders}</p><p className='text-xs text-muted-foreground'>Orders</p></div>
                        <div className='bg-muted/50 rounded p-2 text-center'><p className='text-lg font-bold'>৳{Number(customerSummary.summary.totalSpent).toFixed(0)}</p><p className='text-xs text-muted-foreground'>Spent</p></div>
                      </div>
                      {customerSummary.recentOrders.length > 0 && (
                        <div>
                          <p className='text-xs font-medium text-muted-foreground mb-1'>Recent Orders</p>
                          {customerSummary.recentOrders.map((o: any) => (
                            <div key={o.id} className='flex items-center justify-between py-1 border-b last:border-0'>
                              <span className='font-mono text-xs'>{o.displayId}</span>
                              <div className='flex items-center gap-2'>
                                <Badge style={{ backgroundColor: statusColors[o.status.name] || '#6B7280', color: '#fff' }} className='text-xs'>{o.status.name}</Badge>
                                <span className='text-xs'>৳{Number(o.total).toFixed(0)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : <p className='text-xs text-muted-foreground'>No history found for this number.</p>}
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader className='pb-2 cursor-pointer' onClick={() => setShowCourier(!showCourier)}>
                <CardTitle className='text-base flex items-center justify-between'>
                  <span className='flex items-center gap-1.5'><Truck className='h-4 w-4' /> Courier History</span>
                  {showCourier ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
                </CardTitle>
              </CardHeader>
              {showCourier && (
                <CardContent className='space-y-2 text-sm'>
                  {courierLoading ? <Loader2 className='animate-spin h-4 w-4 mx-auto' /> :
                   courierData?.error ? <p className='text-xs text-muted-foreground'>{courierData.error}</p> :
                   courierData?.Summaries ? (
                    <>
                      {courierSummary?.totalSummary && (
                        <div className='flex gap-2 mb-2'>
                          <Badge variant='secondary' className='text-xs'>Total: {courierSummary.totalSummary['Total Parcels']}</Badge>
                          <Badge className='bg-green-500 text-xs'>Delivered: {courierSummary.totalSummary['Delivered Parcels']}</Badge>
                          <Badge variant='destructive' className='text-xs'>Canceled: {courierSummary.totalSummary['Canceled Parcels']}</Badge>
                        </div>
                      )}
                      {Object.entries(courierData.Summaries as Record<string, any>).map(([name, stats]: [string, any]) => {
                        const total = stats['Total Parcels'] || stats['Total Delivery'] || 0
                        const delivered = stats['Delivered Parcels'] || stats['Successful Delivery'] || 0
                        const canceled = stats['Canceled Parcels'] || stats['Canceled Delivery'] || 0
                        return (
                          <div key={name} className='flex items-center justify-between py-1 border-b last:border-0'>
                            <span className='font-medium text-xs'>{name}</span>
                            <div className='flex gap-2 text-xs'>
                              <span className='text-muted-foreground'>Total: {total}</span>
                              <span className='text-green-600'>Del: {delivered}</span>
                              {canceled > 0 && <span className='text-red-500'>Cxl: {canceled}</span>}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  ) : <p className='text-xs text-muted-foreground'>No courier data or API key not configured.</p>}
                </CardContent>
              )}
            </Card>

            {editing ? (
              <Card>
                <CardHeader className='pb-2'><CardTitle className='text-base flex items-center justify-between'>Edit Order <Button size='sm' onClick={handleSaveEdit}><Save className='h-3.5 w-3.5 mr-1' /> Save</Button></CardTitle></CardHeader>
                <CardContent className='space-y-3'>
                  <div className='grid grid-cols-2 gap-3'>
                    <div><Label className='text-xs'>Shipping</Label><Input type='number' step='0.01' value={shippingCharge} onChange={e => setShippingCharge(e.target.value)} /></div>
                    <div><Label className='text-xs'>Discount</Label><Input type='number' step='0.01' value={discount} onChange={e => setDiscount(e.target.value)} /></div>
                  </div>
                  <div className='flex gap-1 border rounded-md p-0.5 w-fit'>
                    <Button variant={discountType === 'flat' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('flat')}><DollarSign className='h-3 w-3 mr-1' /> Flat</Button>
                    <Button variant={discountType === 'percentage' ? 'default' : 'ghost'} size='sm' className='h-7 text-xs' onClick={() => setDiscountType('percentage')}><Percent className='h-3 w-3 mr-1' /> %</Button>
                  </div>
                  <div className='bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm'>
                    <div className='flex justify-between'><span className='text-muted-foreground'>Subtotal</span><span>৳{fmt(itemSubtotal)}</span></div>
                    <div className='flex justify-between'><span className='text-muted-foreground'>Shipping</span><span>+৳{fmt(parseFloat(shippingCharge) || 0)}</span></div>
                    {rawDiscount > 0 && (
                      <div className='flex justify-between text-green-600'>
                        <span className='text-muted-foreground'>Discount {discountType === 'percentage' ? `(${rawDiscount}%)` : ''}</span>
                        <span>-৳{fmt(effectiveDiscount)}</span>
                      </div>
                    )}
                    <div className='flex justify-between font-bold text-base pt-1.5 border-t border-border/50'>
                      <span>Total</span>
                      <span className='tabular-nums'>৳{fmt(calculatedTotal)}</span>
                    </div>
                  </div>
                  <div><Label className='text-xs'>Customer Notes</Label><Textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} rows={2} placeholder='Customer notes...' /></div>
                  <div><Label className='text-xs'>Office Notes</Label><Textarea value={officeNotes} onChange={e => setOfficeNotes(e.target.value)} rows={2} placeholder='Internal office notes...' /></div>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader className='pb-2'><CardTitle className='text-base'>Details</CardTitle></CardHeader>
                  <CardContent className='space-y-2 text-sm'>
                    <div className='flex justify-between'><span className='text-muted-foreground'>Subtotal</span><span>৳{fmt(order.subtotal)}</span></div>
                    <div className='flex justify-between'><span className='text-muted-foreground'>Shipping</span><span>৳{fmt(order.shippingCharge)}</span></div>
                    {nn(order.discount) > 0 && <div className='flex justify-between text-green-600'><span className='text-muted-foreground'>Discount ({order.discountType})</span><span>-৳{fmt(order.discount)}</span></div>}
                    <div className='flex justify-between font-bold pt-1 border-t'><span>Total</span><span>৳{fmt(order.total)}</span></div>
                  </CardContent>
                </Card>

                {order.customerNotes && (
                  <Card><CardHeader className='pb-2'><CardTitle className='text-base text-xs uppercase text-muted-foreground'>Customer Notes</CardTitle></CardHeader><CardContent><p className='text-sm'>{order.customerNotes}</p></CardContent></Card>
                )}
                {order.officeNotes && (
                  <Card><CardHeader className='pb-2'><CardTitle className='text-base text-xs uppercase text-muted-foreground'>Office Notes</CardTitle></CardHeader><CardContent><p className='text-sm text-muted-foreground'>{order.officeNotes}</p></CardContent></Card>
                )}

                {order.shipment && (
                  <Card><CardHeader className='pb-2'><CardTitle className='text-base'>Shipment</CardTitle></CardHeader><CardContent className='space-y-1 text-sm'><p>Courier: {order.shipment.courier}</p><p>Tracking: {order.shipment.trackingNo}</p><Badge variant='outline'>{order.shipment.status}</Badge></CardContent></Card>
                )}

                {order.payments.map(p => (
                  <Card key={p.id}><CardHeader className='pb-2'><CardTitle className='text-base text-xs flex items-center justify-between'><PaymentLogo method={p.method} size='sm' /><Badge className={p.status === 'verified' ? 'bg-green-500 text-xs' : 'text-xs'}>{p.status}</Badge></CardTitle></CardHeader><CardContent className='space-y-1 text-sm'><p>Amount: ৳{fmt(p.amount)}</p>{p.transactionId && <p>TrxID: {p.transactionId}</p>}</CardContent></Card>
                ))}
              </>
            )}
          </div>
        </div>

        <Dialog open={!!showStatusDialog} onOpenChange={() => setShowStatusDialog(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Change Status</DialogTitle></DialogHeader>
            <div className='space-y-3 py-2'>
              <p className='text-sm'>Current: <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }}>{order.status.name}</Badge></p>
              {showStatusDialog && (
                <p className='text-sm'>New: <Badge style={{ backgroundColor: statusColors[statuses.find((s: any) => s.id === showStatusDialog)?.name] || '#6B7280', color: '#fff' }}>{statuses.find((s: any) => s.id === showStatusDialog)?.name}</Badge></p>
              )}
              <div><Label>Note</Label><Textarea value={statusNote} onChange={e => setStatusNote(e.target.value)} rows={2} placeholder='Add a note for this status change...' /></div>
            </div>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => { setShowStatusDialog(null); setStatusNote(''); }}>Cancel</Button>
              <Button onClick={() => { onUpdateStatus(showStatusDialog!, statusNote || undefined); setShowStatusDialog(null); }}>Confirm</Button>
            </div>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
