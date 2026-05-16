import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ordersApi, mediaUrl } from './api'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, ExternalLink, Printer, X, ChevronLeft, ChevronRight, ArrowUpDown, Truck, ChevronDown, ChevronRight as ChevronRightIcon, Package, MapPin, Mail, StickyNote, Tag, Phone, Clock, Receipt, CreditCard, MessageCircle, FileText } from 'lucide-react'

const statusColors: Record<string, string> = { Pending: '#F59E0B', Confirmed: '#3B82F6', Cancelled: '#EF4444', 'On Hold': '#8B5CF6', Packed: '#06B6D4', Shipped: '#10B981', 'In Courier': '#6366F1', Delivered: '#22C55E', 'Partial Return': '#F97316', 'Return Pending': '#EC4899', Returned: '#DC2626', Damaged: '#991B1B' }
const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

type AddressParts = { line1?: string; line2?: string; city?: string; zone?: string; postcode?: string; country?: string; phone?: string; name?: string }

function parseAddress(addr: any): AddressParts {
  if (!addr || typeof addr !== 'object') return {}
  return {
    line1: addr.address || addr.street || addr.line1 || '',
    line2: addr.line2 || addr.area || '',
    city: addr.city || '',
    zone: addr.state || addr.region || addr.district || '',
    postcode: addr.postcode || addr.zip || addr.postalCode || '',
    country: addr.country || '',
    phone: addr.phone || addr.phoneNumber || '',
    name: addr.name || '',
  }
}

function getProductThumb(item: any): string | null {
  const imgs = item?.product?.images
  if (!imgs) return null
  if (Array.isArray(imgs) && imgs.length > 0) {
    const first = imgs[0]
    const url = typeof first === 'string' ? first : first?.url || first?.src || first?.path || ''
    return url ? mediaUrl(url) : null
  }
  if (typeof imgs === 'object' && !Array.isArray(imgs)) {
    const url = imgs.url || imgs.src || imgs.path || ''
    return url ? mediaUrl(url) : null
  }
  return null
}

function paymentMethodLabel(method: string): { label: string; icon: React.ReactNode } {
  const m = method?.toLowerCase() || ''
  if (m.includes('bkash') || m.includes('bKash')) return { label: 'bKash', icon: <CreditCard className='h-3.5 w-3.5 text-pink-500' /> }
  if (m.includes('nagad')) return { label: 'Nagad', icon: <CreditCard className='h-3.5 w-3.5 text-orange-500' /> }
  if (m.includes('rocket')) return { label: 'Rocket', icon: <CreditCard className='h-3.5 w-3.5 text-purple-500' /> }
  if (m.includes('card') || m.includes('visa') || m.includes('master')) return { label: method, icon: <CreditCard className='h-3.5 w-3.5 text-blue-500' /> }
  if (m.includes('cod') || m.includes('cash') || m.includes('delivery')) return { label: 'COD', icon: <Receipt className='h-3.5 w-3.5 text-green-500' /> }
  if (m.includes('bank') || m.includes('transfer')) return { label: method, icon: <CreditCard className='h-3.5 w-3.5 text-slate-500' /> }
  return { label: method, icon: <CreditCard className='h-3.5 w-3.5 text-muted-foreground' /> }
}

export function Orders() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [customRows, setCustomRows] = useState('')
  const [showCustomRows, setShowCustomRows] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [courierFilter, setCourierFilter] = useState('all')
  const [sort, setSort] = useState('createdAt')
  const [order, setOrder] = useState('desc')
  const [selected, setSelected] = useState<string[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350); return () => clearTimeout(t) }, [search])

  const { data: statuses } = useQuery({ queryKey: ['order-statuses'], queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]) })
  const statusList = (Array.isArray(statuses) ? statuses : []) as any[]

  const { data, isLoading } = useQuery({
    queryKey: ['orders', page, perPage, debouncedSearch, statusFilter, courierFilter, sort, order],
    queryFn: () => ordersApi.list({ page, perPage, search: debouncedSearch || undefined, statusId: statusFilter !== 'all' ? statusFilter : undefined, courier: courierFilter !== 'all' ? courierFilter : undefined, sort, order }).then(r => r.data),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, statusId }: { id: string; statusId: string }) => ordersApi.updateStatus(id, statusId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); toast.success('Status updated') },
  })

  const bulkStatusMut = useMutation({
    mutationFn: (d: { ids: string[]; statusId: string }) => apiClient.post('/orders/bulk/status', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); setSelected([]); toast.success('Bulk status updated') },
  })

  const toggleAll = () => { const ids = data?.data?.map((o: any) => o.id) || []; setSelected(selected.length === ids.length ? [] : ids) }
  const toggleOne = (id: string) => setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id])
  const toggleExpand = useCallback((id: string) => setExpandedRows(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next }), [])

  const totalOrders = data?.meta?.total || 0
  const totalPages = data?.meta?.totalPages || 1

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-end justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Orders</h2>
            <p className='text-muted-foreground text-sm'>{totalOrders} orders found</p>
          </div>
        </div>

        <Card>
          <CardContent className='p-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <Input placeholder='Search order/customer/phone...' value={search} onChange={e => setSearch(e.target.value)} className='h-8 text-sm max-w-xs' />
              <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
                <SelectTrigger className='h-8 w-[140px] text-sm'><SelectValue placeholder='All Statuses' /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All Statuses</SelectItem>
                  {statusList.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={courierFilter} onValueChange={v => { setCourierFilter(v); setPage(1) }}>
                <SelectTrigger className='h-8 w-[140px] text-sm'><SelectValue placeholder='All Couriers' /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All Couriers</SelectItem>
                  {['steadfast','pathao','redx','carrybee'].map(c => <SelectItem key={c} value={c} className='capitalize'>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(perPage)} onValueChange={v => { if (v === 'custom') { setShowCustomRows(true) } else { setPerPage(parseInt(v)); setPage(1) } }}>
                <SelectTrigger className='h-8 w-[100px] text-sm'><SelectValue /></SelectTrigger>
                <SelectContent>{[10,25,50,100,200,500,1000].map(n => <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>)}<SelectItem value='custom'>Custom...</SelectItem></SelectContent>
              </Select>
              {showCustomRows && (
                <div className='flex items-center gap-1'>
                  <Input type='number' className='h-8 w-20 text-sm' placeholder='Rows' value={customRows} onChange={e => setCustomRows(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { const n = Math.max(1, Math.min(5000, parseInt(customRows) || 10)); setPerPage(n); setShowCustomRows(false); setCustomRows(''); setPage(1) } }} />
                  <Button size='sm' className='h-8' onClick={() => { const n = Math.max(1, Math.min(5000, parseInt(customRows) || 10)); setPerPage(n); setShowCustomRows(false); setCustomRows(''); setPage(1) }}>Set</Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-10'><Checkbox checked={(data?.data?.length ?? 0) > 0 && selected.length === (data?.data?.length ?? 0)} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead className='w-8'></TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead className='text-right cursor-pointer select-none' onClick={() => { setSort('total'); setOrder(o => o === 'asc' ? 'desc' : 'asc') }}>
                    Total {sort === 'total' ? (order === 'asc' ? '↑' : '↓') : <ArrowUpDown className='h-3 w-3 inline ml-1' />}
                  </TableHead>
                  <TableHead className='text-right'>Items</TableHead>
                  <TableHead className='cursor-pointer select-none' onClick={() => { setSort('createdAt'); setOrder(o => o === 'asc' ? 'desc' : 'asc') }}>
                    Date {sort === 'createdAt' ? (order === 'asc' ? '↑' : '↓') : <ArrowUpDown className='h-3 w-3 inline ml-1' />}
                  </TableHead>
                  <TableHead className='text-center'>Track</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={11} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
                 data?.data?.length ? data.data.flatMap((o: any) => {
                  const isExpanded = expandedRows.has(o.id)
                  const addr = useMemo(() => parseAddress(o.shippingAddress), [o.shippingAddress])
                  const accentColor = statusColors[o.status?.name] || '#6B7280'
                  return [
                    <TableRow key={o.id} className={`${selected.includes(o.id) ? 'bg-muted/30' : ''} cursor-pointer transition-colors hover:bg-muted/40`} onClick={() => toggleExpand(o.id)}
                      style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}>
                      <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selected.includes(o.id)} onCheckedChange={() => toggleOne(o.id)} /></TableCell>
                      <TableCell className='px-1'>
                        <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                          <ChevronRightIcon className='h-3.5 w-3.5 text-muted-foreground' />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link to='/op/orders/$id' params={{ id: o.id }} className='font-mono text-sm font-semibold text-primary hover:underline' onClick={e => e.stopPropagation()}>{o.displayId}</Link>
                      </TableCell>
                      <TableCell>
                        <div className='text-sm font-medium leading-tight'>{o.customer.firstName} {o.customer.lastName}</div>
                        <div className='text-[11px] text-muted-foreground mt-0.5'>{o.customer.phoneNumber}</div>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Select value={o.status.id} onValueChange={v => statusMut.mutate({ id: o.id, statusId: v })}>
                          <SelectTrigger className='h-7 w-[130px] text-xs border-0 bg-transparent hover:bg-muted' style={{ backgroundColor: accentColor + '15' }}>
                            <SelectValue>
                              <div className='flex items-center gap-1.5'>
                                <span className='h-2 w-2 rounded-full shrink-0' style={{ backgroundColor: accentColor }} />
                                <span className='text-xs font-medium' style={{ color: accentColor }}>{o.status.name}</span>
                              </div>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {statusList.filter((s: any) => {
                              const next = Array.isArray(o.status.nextStatuses) ? o.status.nextStatuses : []
                              return s.id === o.status.id || next.includes(s.id)
                            }).map((s: any) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {o.courierService
                          ? <Badge variant='outline' className='text-xs capitalize gap-1'><Truck className='h-2.5 w-2.5' /> {o.courierService}</Badge>
                          : <span className='text-xs text-muted-foreground'>—</span>}
                      </TableCell>
                      <TableCell className='text-right font-semibold text-sm'>৳{fmt(o.total)}</TableCell>
                      <TableCell className='text-right text-sm text-muted-foreground'>{o.items.length}</TableCell>
                      <TableCell>
                        <div className='text-xs'>{new Date(o.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</div>
                        <div className='text-[11px] text-muted-foreground'>{relativeTime(o.createdAt)}</div>
                      </TableCell>
                      <TableCell className='text-center' onClick={e => e.stopPropagation()}>
                        {o.trackingUrl ? <Button size='icon' variant='ghost' className='h-7 w-7' title='Track' onClick={() => window.open(o.trackingUrl, '_blank')}><ExternalLink className='h-3.5 w-3.5' /></Button> : <span className='text-xs text-muted-foreground'>—</span>}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <div className='flex items-center gap-0.5'>
                          <Button size='icon' variant='ghost' className='h-7 w-7' title='Sticker' onClick={() => window.open(`/admin/op/print/sticker/${o.id}`, '_blank')}><Printer className='h-3.5 w-3.5' /></Button>
                        </div>
                      </TableCell>
                    </TableRow>,
                    isExpanded && (
                      <TableRow key={`${o.id}-detail`} className='bg-muted/10'>
                        <TableCell colSpan={11} className='p-0'>
                          <div className='overflow-hidden' style={{ borderTop: `2px solid ${accentColor}` }}>
                            <div className='px-6 py-5 grid grid-cols-1 lg:grid-cols-5 gap-5'>
                              <div className='lg:col-span-3 space-y-3'>
                                <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                                  <Package className='h-3.5 w-3.5' /> Products
                                  <span className='text-[10px] font-normal normal-case tracking-normal'>({o.items.length} item{o.items.length > 1 ? 's' : ''})</span>
                                </div>
                                <div className='space-y-1.5'>
                                  {o.items.map((item: any) => {
                                    const thumb = getProductThumb(item)
                                    const lineTotal = nn(item.price) * item.quantity
                                    return (
                                      <div key={item.id} className='flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 shadow-sm'>
                                        {thumb ? (
                                          <img src={thumb} alt={item.product?.name} className='h-11 w-11 rounded-md object-cover border shrink-0' />
                                        ) : (
                                          <div className='h-11 w-11 rounded-md border bg-muted/50 flex items-center justify-center shrink-0'>
                                            <Package className='h-4 w-4 text-muted-foreground/60' />
                                          </div>
                                        )}
                                        <div className='flex-1 min-w-0'>
                                          <div className='text-sm font-medium truncate leading-tight'>{item.product?.name || 'Unknown Product'}</div>
                                          <div className='flex items-center gap-2.5 mt-0.5'>
                                            <span className='text-[11px] text-muted-foreground'>৳{fmt(item.price)} each</span>
                                            {item.variantId && <span className='text-[11px] text-muted-foreground/70'>Variant: {item.variantId}</span>}
                                          </div>
                                        </div>
                                        <div className='text-right shrink-0'>
                                          <div className='text-sm font-semibold'>৳{fmt(lineTotal)}</div>
                                          <div className='text-[11px] text-muted-foreground'>x{item.quantity}</div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                                <div className='rounded-lg border bg-background p-3 shadow-sm'>
                                  <div className='space-y-1.5 text-sm'>
                                    <div className='flex justify-between text-muted-foreground'><span>Subtotal</span><span className='font-medium text-foreground'>৳{fmt(o.subtotal)}</span></div>
                                    <div className='flex justify-between text-muted-foreground'><span>Shipping</span><span className='font-medium text-foreground'>৳{fmt(o.shippingCharge)}</span></div>
                                    {nn(o.discount) > 0 && (
                                      <div className='flex justify-between text-emerald-600 dark:text-emerald-400'>
                                        <span className='flex items-center gap-1'>
                                          <Tag className='h-3 w-3' />
                                          Discount {o.discountType === 'percentage' ? `(${fmt(o.discount)}%)` : ''}
                                        </span>
                                        <span className='font-medium'>-৳{fmt(o.discountType === 'percentage' ? nn(o.subtotal) * nn(o.discount) / 100 : o.discount)}</span>
                                      </div>
                                    )}
                                    <div className='flex justify-between font-bold text-base pt-2 border-t'><span>Total</span><span>৳{fmt(o.total)}</span></div>
                                  </div>
                                </div>
                              </div>

                              <div className='lg:col-span-2 space-y-3'>
                                <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                                  <MapPin className='h-3.5 w-3.5' /> Shipping & Customer
                                </div>
                                <div className='rounded-lg border bg-background p-3.5 shadow-sm space-y-2.5'>
                                  {(addr.name || o.customer.firstName) && (
                                    <div className='font-medium text-sm'>{addr.name || `${o.customer.firstName} ${o.customer.lastName}`}</div>
                                  )}
                                  {(addr.line1 || addr.line2) && (
                                    <div className='text-sm leading-relaxed'>{[addr.line1, addr.line2].filter(Boolean).join(', ')}</div>
                                  )}
                                  {[addr.city, addr.zone].filter(Boolean).length > 0 && (
                                    <div className='text-sm text-muted-foreground'>{[addr.city, addr.zone].filter(Boolean).join(', ')}</div>
                                  )}
                                  {addr.postcode && (
                                    <div className='text-sm text-muted-foreground'>{addr.postcode}{addr.country && addr.country !== 'Bangladesh' ? `, ${addr.country}` : ''}</div>
                                  )}
                                  {!addr.line1 && !addr.line2 && !addr.city && (
                                    <div className='text-sm text-muted-foreground italic'>No address provided</div>
                                  )}
                                  <div className='flex flex-col gap-1.5 pt-1 border-t'>
                                    <div className='flex items-center gap-2 text-sm'>
                                      <Phone className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
                                      <span>{o.customer.phoneNumber}</span>
                                    </div>
                                    {o.customer.email && (
                                      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                                        <Mail className='h-3.5 w-3.5 shrink-0' />
                                        <span className='truncate'>{o.customer.email}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {(o.customerNotes || o.officeNotes) && (
                                  <div className='space-y-1.5'>
                                    {o.customerNotes && (
                                      <div className='rounded-lg border-l-4 border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2.5 shadow-sm'>
                                        <div className='flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1'>
                                          <MessageCircle className='h-3 w-3' /> Customer Note
                                        </div>
                                        <div className='text-sm leading-relaxed'>{o.customerNotes}</div>
                                      </div>
                                    )}
                                    {o.officeNotes && (
                                      <div className='rounded-lg border-l-4 border-l-blue-400 bg-blue-50/50 dark:bg-blue-950/20 px-3 py-2.5 shadow-sm'>
                                        <div className='flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider mb-1'>
                                          <FileText className='h-3 w-3' /> Office Note
                                        </div>
                                        <div className='text-sm leading-relaxed'>{o.officeNotes}</div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {o.payments && o.payments.length > 0 && (
                                  <div className='space-y-1.5'>
                                    <div className='text-[11px] font-semibold text-muted-foreground uppercase tracking-wider'>Payments</div>
                                    {o.payments.map((p: any) => {
                                      const pm = paymentMethodLabel(p.method)
                                      return (
                                        <div key={p.id} className='flex items-center justify-between rounded-lg border bg-background px-3 py-2 shadow-sm'>
                                          <div className='flex items-center gap-2'>
                                            {pm.icon}
                                            <span className='text-sm font-medium'>{pm.label}</span>
                                          </div>
                                          <div className='flex items-center gap-2'>
                                            <span className='text-sm font-semibold'>৳{fmt(p.amount)}</span>
                                            <Badge variant={p.status === 'completed' || p.status === 'paid' || p.status === 'verified' ? 'default' : 'secondary'}
                                              className={`text-[10px] ${p.status === 'completed' || p.status === 'paid' || p.status === 'verified' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' : ''}`}>
                                              {p.status}
                                            </Badge>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  ].filter(Boolean)
                 }) : <TableRow><TableCell colSpan={11} className='text-center py-8 text-muted-foreground'>No orders found</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className='flex items-center justify-between'>
            <span className='text-sm text-muted-foreground'>Page {page} of {totalPages} ({totalOrders} orders)</span>
            <div className='flex items-center gap-1'>
              <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className='h-4 w-4' /></Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .map((p, i, arr) => (
                  <span key={p}>
                    {i > 0 && arr[i - 1] !== p - 1 && <span className='px-1 text-muted-foreground'>...</span>}
                    <Button variant={p === page ? 'default' : 'outline'} size='sm' className='h-8 w-8' onClick={() => setPage(p)}>{p}</Button>
                  </span>
                ))}
              <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className='h-4 w-4' /></Button>
            </div>
          </div>
        )}

        {selected.length > 0 && (
          <div className='fixed bottom-4 left-1/2 -translate-x-1/2 bg-background border rounded-lg shadow-lg px-4 py-3 flex items-center gap-4 z-50'>
            <Button variant='ghost' size='icon' className='h-6 w-6' onClick={() => setSelected([])}><X className='h-4 w-4' /></Button>
            <span className='text-sm font-medium'>{selected.length} selected</span>
            <Select onValueChange={v => bulkStatusMut.mutate({ ids: selected, statusId: v })}>
              <SelectTrigger className='h-8 w-[160px] text-sm'><SelectValue placeholder='Change Status' /></SelectTrigger>
              <SelectContent>{statusList.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant='outline' size='sm' onClick={() => { const ids = selected.join(','); window.open(`/admin/op/print/bulk?type=sticker&ids=${ids}`, '_blank') }}><Printer className='h-3.5 w-3.5 mr-1' /> Stickers</Button>
            <Button variant='outline' size='sm' onClick={() => { const ids = selected.join(','); window.open(`/admin/op/print/bulk?type=invoice&ids=${ids}`, '_blank') }}><Printer className='h-3.5 w-3.5 mr-1' /> Invoices</Button>
          </div>
        )}
      </Main>
    </>
  )
}