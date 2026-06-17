import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ordersApi, mediaUrl } from './api'
import type { OrderResponse } from './api'
import { SafeImage } from '@/components/safe-image'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuGroup } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Loader2, ExternalLink, Printer, X, ChevronLeft, ChevronRight, ArrowUpDown, Truck, ChevronRight as ChevronRightIcon, Package, MapPin, Mail, Tag, Phone, Receipt, CreditCard, MessageCircle, FileText, ClipboardCopy, MoreHorizontal, Inbox, Eye, UserPlus, UserCheck, Search as SearchIcon, Send, Plus } from 'lucide-react'
import { SearchableSelect } from '@/components/ui/searchable-select'

const fallbackStatusColors: Record<string, string> = { Pending: '#F59E0B', Confirmed: '#3B82F6', Cancelled: '#EF4444', 'On Hold': '#8B5CF6', Packed: '#06B6D4', Shipped: '#10B981', 'In Courier': '#6366F1', Delivered: '#22C55E', 'Partial Return': '#F97316', 'Return Pending': '#EC4899', Returned: '#DC2626', Damaged: '#991B1B' }
const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

function getStatusColor(statusName: string, statusColor?: string): string {
  if (statusColor && statusColor !== '#6B7280') return statusColor
  return fallbackStatusColors[statusName] || '#6B7280'
}

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

function parseAddress(addr: unknown): AddressParts {
  if (!addr || typeof addr !== 'object') return {}
  const a = addr as Record<string, unknown>
  return {
    line1: (a.address || a.street || a.line1 || '') as string,
    line2: (a.line2 || a.area || '') as string,
    city: (a.city || '') as string,
    zone: (a.state || a.region || a.district || '') as string,
    postcode: (a.postcode || a.zip || a.postalCode || '') as string,
    country: (a.country || '') as string,
    phone: (a.phone || a.phoneNumber || '') as string,
    name: (a.name || '') as string,
  }
}

function formatAddressFull(addr: AddressParts): string {
  return [
    addr.line1,
    addr.line2,
    addr.city,
    addr.zone,
    addr.postcode,
    addr.country && addr.country !== 'Bangladesh' ? addr.country : '',
  ].filter(Boolean).join(', ')
}

function getProductThumb(item: OrderResponse['items'][number]): string | null {
  const imgs = item?.product?.images
  if (!imgs) return null
  if (Array.isArray(imgs) && imgs.length > 0) {
    const first = imgs[0]
    const url = typeof first === 'string' ? first : (first as Record<string, unknown>)?.url || (first as Record<string, unknown>)?.src || (first as Record<string, unknown>)?.path || ''
    return url ? mediaUrl(url as string) : null
  }
  if (typeof imgs === 'object' && !Array.isArray(imgs)) {
    const imgObj = imgs as Record<string, unknown>
    const url = (imgObj.url || imgObj.src || imgObj.path || '') as string
    return url ? mediaUrl(url) : null
  }
  return null
}

function paymentMethodLabel(method: string): { label: string; colorClass: string } {
  const m = method?.toLowerCase() || ''
  if (m.includes('bkash')) return { label: 'bKash', colorClass: 'text-pink-500' }
  if (m.includes('nagad')) return { label: 'Nagad', colorClass: 'text-orange-500' }
  if (m.includes('rocket')) return { label: 'Rocket', colorClass: 'text-purple-500' }
  if (m.includes('card') || m.includes('visa') || m.includes('master')) return { label: method, colorClass: 'text-blue-500' }
  if (m.includes('cod') || m.includes('cash') || m.includes('delivery')) return { label: 'COD', colorClass: 'text-emerald-600 dark:text-emerald-400' }
  if (m.includes('bank') || m.includes('transfer')) return { label: method, colorClass: 'text-slate-500' }
  if (m.includes('gateway')) return { label: method.split('_').slice(1).join(' ') || method, colorClass: 'text-muted-foreground' }
  return { label: method, colorClass: 'text-muted-foreground' }
}

function paymentStatusBadgeClass(status: string): { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string } {
  const s = status?.toLowerCase() || ''
  if (['paid', 'verified', 'completed'].includes(s)) return { variant: 'default', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' }
  if (['pending', 'payment_pending'].includes(s)) return { variant: 'secondary', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800' }
  if (['failed', 'cancelled', 'unpaid'].includes(s)) return { variant: 'destructive', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' }
  if (s === 'partial_paid') return { variant: 'default', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' }
  if (s === 'refunded') return { variant: 'outline', className: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-200 dark:border-pink-800' }
  return { variant: 'outline', className: '' }
}

async function copyToClipboard(text: string, label?: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(label ? `${label} copied` : 'Copied to clipboard')
  } catch {
    toast.error('Failed to copy')
  }
}

function OrderRowSkeleton() {
  return (
    <TableRow>
      <TableCell><Skeleton className='h-4 w-4' /></TableCell>
      <TableCell><Skeleton className='h-4 w-4' /></TableCell>
      <TableCell><div className='space-y-1'><Skeleton className='h-4 w-24' /><Skeleton className='h-3 w-16' /></div></TableCell>
      <TableCell><div className='space-y-1'><Skeleton className='h-4 w-28' /><Skeleton className='h-3 w-24' /></div></TableCell>
      <TableCell><Skeleton className='h-6 w-[100px] rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-5 w-24 rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-5 w-20 rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-4 w-16 ml-auto' /></TableCell>
      <TableCell><Skeleton className='h-4 w-6 ml-auto' /></TableCell>
      <TableCell><Skeleton className='h-7 w-7 rounded' /></TableCell>
    </TableRow>
  )
}

function EmptyState({ search, statusFilter, onClear }: { search: string; statusFilter: string; onClear: () => void }) {
  return (
    <div className='flex flex-col items-center justify-center py-16 px-4'>
      <div className='h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4'>
        <Inbox className='h-8 w-8 text-muted-foreground' />
      </div>
      <h3 className='text-lg font-semibold mb-1'>No orders found</h3>
      <p className='text-sm text-muted-foreground text-center max-w-sm'>
        {(search || statusFilter !== 'all')
          ? 'No orders match your current filters. Try adjusting your search or filters.'
          : 'No orders have been placed yet.'}
      </p>
      {(search || statusFilter !== 'all') && (
        <Button variant='outline' size='sm' className='mt-4' onClick={onClear}>
          <X className='h-3.5 w-3.5 mr-1.5' /> Clear filters
        </Button>
      )}
    </div>
  )
}

export function Orders() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [customRows, setCustomRows] = useState('')
  const [showCustomRows, setShowCustomRows] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [courierFilter, setCourierFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [sort, setSort] = useState('createdAt')
  const [order, setOrder] = useState('desc')
  const [selected, setSelected] = useState<string[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [statusDialog, setStatusDialog] = useState<{ order: OrderResponse; newStatusId: string; newStatusName: string } | null>(null)
  const [statusNote, setStatusNote] = useState('')

  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const { data: statuses } = useQuery({ queryKey: ['order-statuses'], queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]) })
  const statusList = (Array.isArray(statuses) ? statuses : []) as any[]
  const { data: staffList } = useQuery({ queryKey: ['staff-list'], queryFn: () => apiClient.get('/orders/staff/list').then(r => r.data as any[]) })
  const staff = (Array.isArray(staffList) ? staffList : []) as any[]

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['orders', page, perPage, debouncedSearch, statusFilter, courierFilter, assigneeFilter, sort, order],
    queryFn: () => ordersApi.list({ page, perPage, search: debouncedSearch || undefined, statusId: statusFilter !== 'all' ? statusFilter : undefined, courier: courierFilter !== 'all' ? courierFilter : undefined, assignedToId: assigneeFilter !== 'all' ? assigneeFilter : undefined, sort, order }).then(r => r.data),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, statusId, note }: { id: string; statusId: string; note?: string }) => ordersApi.updateStatus(id, statusId, note),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); toast.success('Status updated') },
  })

  const bulkStatusMut = useMutation({
    mutationFn: (d: { ids: string[]; statusId: string }) => apiClient.post('/orders/bulk/status', d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); setSelected([]); toast.success('Bulk status updated') },
  })

  const bulkAssignMut = useMutation({
    mutationFn: (d: { ids: string[]; assignedToId: string | null }) => ordersApi.bulkAssign(d.ids, d.assignedToId === '__unassign__' ? null : d.assignedToId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['orders'] }); setSelected([]); toast.success('Orders assigned') },
  })

  const { data: courierCreds } = useQuery({ queryKey: ['courier-creds'], queryFn: () => apiClient.get('/couriers/credentials').then(r => r.data as any[]) })
  const activeCouriers = (Array.isArray(courierCreds) ? courierCreds : []) as any[]
  const [dispatchCourier, setDispatchCourier] = useState('')

  const dispatchMut = useMutation({
    mutationFn: ({ courier, ids }: { courier: string; ids: string[] }) => apiClient.post(`/couriers/dispatch/${courier}`, { orderIds: ids }),
    onSuccess: (res) => {
      const results = (res as any)?.data as any[] || []
      const succeeded = results.filter((r: any) => r.ok)
      const failed = results.filter((r: any) => !r.ok)
      if (failed.length > 0) {
        toast.error(`${failed.length} order(s) failed to dispatch`)
        failed.forEach((r: any) => toast.error(r.message || 'Unknown error', { id: r.id }))
      }
      if (succeeded.length > 0) toast.success(`${succeeded.length} order(s) dispatched to courier`)
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      setSelected([])
      setDispatchCourier('')
    },
    onError: (e: unknown) => { toast.error((e as Error).message || 'Dispatch failed') },
  })

  const toggleAll = () => { const ids = data?.data?.map((o: OrderResponse) => o.id) || []; setSelected(selected.length === ids.length ? [] : ids) }
  const toggleOne = (id: string) => setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id])
  const toggleExpand = useCallback((id: string) => setExpandedRows(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next }), [])

  const clearAllFilters = () => { setSearch(''); setStatusFilter('all'); setCourierFilter('all'); setAssigneeFilter('all'); setPage(1) }
  const hasActiveFilters = search || statusFilter !== 'all' || courierFilter !== 'all' || assigneeFilter !== 'all'

  const statusCountMap = useMemo(() => {
    if (!data?.data) return {} as Record<string, number>
    const map: Record<string, number> = {}
    for (const o of data.data) {
      const key = o.status?.name || 'Unknown'
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [data?.data])

  const totalRevenue = useMemo(() => {
    if (!data?.data) return 0
    return data.data.reduce((sum: number, o: OrderResponse) => sum + nn(o.total), 0)
  }, [data?.data])

  const totalOrders = data?.meta?.total || 0
  const totalPages = data?.meta?.totalPages || 1

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-end justify-between'>
          <div>
            <div className='flex items-center gap-3'>
              <h2 className='text-2xl font-bold tracking-tight'>Orders</h2>
              {isFetching && (
                <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                  <Loader2 className='h-3 w-3 animate-spin' />
                  Refreshing...
                </div>
              )}
            </div>
            <p className='text-muted-foreground text-sm'>{totalOrders} orders found{data?.data ? ` · ৳${fmt(totalRevenue)} total` : ''}</p>
          </div>
          <Button onClick={() => navigate({ to: '/op/orders/create' })}>
            <Plus className='h-4 w-4 mr-1' /> Create Order
          </Button>
        </div>

        <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
          {statusList.slice(0, 4).map((s: any) => {
            const color = getStatusColor(s.name, s.color)
            const count = statusCountMap[s.name] || 0
            const isActive = statusFilter === s.id
            return (
              <button
                key={s.id}
                onClick={() => { setStatusFilter(isActive ? 'all' : s.id); setPage(1) }}
                className={`relative overflow-hidden rounded-lg border p-3 text-left transition-all hover:shadow-sm ${isActive ? 'ring-2 ring-primary' : ''}`}
              >
                <div className='absolute top-0 left-0 w-1 h-full rounded-l-lg' style={{ backgroundColor: color }} />
                <div className='pl-2'>
                  <p className='text-xs text-muted-foreground'>{s.name}</p>
                  <p className='text-xl font-bold'>{count}</p>
                </div>
              </button>
            )
          })}
        </div>

        <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10 backdrop-blur-sm'>
          <CardContent className='p-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='relative w-[220px]'>
                <SearchIcon className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                <Input 
                  ref={searchInputRef} 
                  placeholder='Search orders...' 
                  value={search} 
                  onChange={e => setSearch(e.target.value)} 
                  className='h-9 text-sm pl-9 pr-7 bg-background/70 focus:bg-background border-none shadow-sm transition-colors' 
                />
                {search && (
                  <button onClick={() => setSearch('')} className='absolute right-2 top-1/2 -translate-y-1/2 hover:text-foreground transition-colors'>
                    <X className='h-3.5 w-3.5 text-muted-foreground' />
                  </button>
                )}
              </div>
              
              <div className='w-[140px]'>
                <SearchableSelect
                  options={[
                    { id: 'all', label: 'All Statuses' },
                    ...statusList.map((s: any) => ({
                      id: s.id,
                      label: s.name,
                      icon: <span className='h-2 w-2 rounded-full shrink-0' style={{ backgroundColor: getStatusColor(s.name, s.color) }} />
                    }))
                  ]}
                  value={statusFilter}
                  onChange={(v) => { setStatusFilter(v || 'all'); setPage(1) }}
                  placeholder='Status'
                  searchPlaceholder='Search status...'
                  triggerClassName='h-9 text-sm bg-background/70 focus:bg-background border-none shadow-sm'
                />
              </div>

              <div className='w-[130px]'>
                <Select value={courierFilter} onValueChange={v => { setCourierFilter(v); setPage(1) }}>
                  <SelectTrigger className='h-9 text-sm bg-background/70 focus:bg-background border-none shadow-sm'>
                    <SelectValue placeholder='Courier' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>All Couriers</SelectItem>
                    {['steadfast','pathao','redx','carrybee'].map(c => <SelectItem key={c} value={c} className='capitalize text-sm'>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className='w-[160px]'>
                <SearchableSelect
                  options={[
                    { id: 'all', label: 'All Staff' },
                    { id: 'unassigned', label: 'Unassigned' },
                    ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() }))
                  ]}
                  value={assigneeFilter}
                  onChange={(v) => { setAssigneeFilter(v); setPage(1) }}
                  placeholder='Staff'
                  searchPlaceholder='Search staff...'
                  triggerClassName='h-9 text-sm bg-background/70 focus:bg-background border-none shadow-sm'
                />
              </div>

              <div className='w-[90px]'>
                <Select value={String(perPage)} onValueChange={v => { if (v === 'custom') { setShowCustomRows(true) } else { setPerPage(parseInt(v)); setPage(1) } }}>
                  <SelectTrigger className='h-9 text-sm bg-background/70 focus:bg-background border-none shadow-sm'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10,25,50,100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    <SelectItem value='custom'>Custom...</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {showCustomRows && (
                <div className='flex items-center gap-1 animate-in fade-in slide-in-from-left-2 duration-200'>
                  <Input type='number' className='h-9 w-16 text-sm bg-background/70' placeholder='#' value={customRows} onChange={e => setCustomRows(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { const n = Math.max(1, Math.min(5000, parseInt(customRows) || 10)); setPerPage(n); setShowCustomRows(false); setCustomRows(''); setPage(1) } }} />
                  <Button size='sm' variant='ghost' className='h-8 w-8 px-0 hover:bg-background/50' onClick={() => { const n = Math.max(1, Math.min(5000, parseInt(customRows) || 10)); setPerPage(n); setShowCustomRows(false); setCustomRows(''); setPage(1) }}>✓</Button>
                </div>
              )}

              {hasActiveFilters && (
                <Button variant='ghost' size='sm' className='h-9 text-sm text-muted-foreground hover:text-foreground hover:bg-background/50' onClick={clearAllFilters}>
                  <X className='h-4 w-4 mr-1.5' />Reset
                </Button>
              )}
            </div>
            {hasActiveFilters && (
              <div className='flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-muted-foreground/10'>
                {statusFilter !== 'all' && (() => { const s = statusList.find((st: any) => st.id === statusFilter); return s ? (
                  <button onClick={() => { setStatusFilter('all'); setPage(1) }} className='inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs font-medium border shadow-sm hover:bg-muted transition-colors'>
                    <span className='h-1.5 w-1.5 rounded-full' style={{ backgroundColor: getStatusColor(s.name, s.color) }} />{s.name}<X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                  </button>
                ) : null })()}
                {courierFilter !== 'all' && (
                  <button onClick={() => { setCourierFilter('all'); setPage(1) }} className='inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs font-medium border shadow-sm hover:bg-muted transition-colors'>
                    <Truck className='h-3 w-3 text-muted-foreground' />{courierFilter}<X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                  </button>
                )}
                {assigneeFilter !== 'all' && (() => { const person = assigneeFilter === 'unassigned' ? null : staff.find((s: any) => s.id === assigneeFilter); return (
                  <button onClick={() => { setAssigneeFilter('all'); setPage(1) }} className='inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs font-medium border shadow-sm hover:bg-muted transition-colors'>
                    <UserCheck className='h-3 w-3 text-muted-foreground' />{assigneeFilter === 'unassigned' ? 'Unassigned' : person ? `${person.firstName}` : 'Staff'}<X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                  </button>
                ) })()}
                {search && (
                  <button onClick={() => setSearch('')} className='inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs font-medium border shadow-sm hover:bg-muted transition-colors'>
                    <span className='text-muted-foreground'>Search:</span> "{search.slice(0,15)}{search.length > 15 ? '...' : ''}"<X className='h-3 w-3 ml-0.5 text-muted-foreground' />
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-0'>
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader className='sticky top-0 bg-background z-10'>
                  <TableRow>
                    <TableHead className='w-10'><Checkbox checked={(data?.data?.length ?? 0) > 0 && selected.length === (data?.data?.length ?? 0)} onCheckedChange={toggleAll} /></TableHead>
                    <TableHead className='w-8'></TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Courier</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead className='text-right cursor-pointer select-none' onClick={() => { setSort('total'); setOrder(o => o === 'asc' ? 'desc' : 'asc') }}>
                      Total {sort === 'total' ? (order === 'asc' ? '↑' : '↓') : <ArrowUpDown className='h-3 w-3 inline ml-1' />}
                    </TableHead>
                    <TableHead className='text-right'>Items</TableHead>
                    <TableHead className='w-10'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <>
                      <OrderRowSkeleton /><OrderRowSkeleton /><OrderRowSkeleton />
                      <OrderRowSkeleton /><OrderRowSkeleton /><OrderRowSkeleton />
                    </>
                  ) : data?.data?.length ? data.data.flatMap((o: OrderResponse) => {
                    const isExpanded = expandedRows.has(o.id)
                    const addr = parseAddress(o.shippingAddress)
                    const accentColor = getStatusColor(o.status?.name, o.status?.color)
                    const isSelected = selected.includes(o.id)
                    return [
                      <TableRow key={o.id} className={`${isSelected ? 'bg-muted/30' : 'even:bg-muted/[0.02]'} cursor-pointer transition-colors hover:bg-muted/50`} onClick={() => toggleExpand(o.id)}
                        style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}>
                        <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={isSelected} onCheckedChange={() => toggleOne(o.id)} /></TableCell>
                        <TableCell className='px-1'>
                          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRightIcon className='h-3.5 w-3.5 text-muted-foreground' />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='flex items-center gap-2'>
                            <Link to='/op/orders/$id' params={{ id: o.id }} className='font-mono text-sm font-semibold text-primary hover:underline' onClick={e => e.stopPropagation()}>{o.displayId}</Link>
                            <Tooltip>
                              <TooltipTrigger asChild><button onClick={e => { e.stopPropagation(); copyToClipboard(o.displayId, 'Order ID') }} className='opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground'><ClipboardCopy className='h-3 w-3' /></button></TooltipTrigger>
                              <TooltipContent>Copy order ID</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className='flex items-center gap-1.5 mt-0.5'>
                            <span className='cursor-pointer text-[11px] text-muted-foreground select-none' onClick={e => { e.stopPropagation(); setSort('createdAt'); setOrder(prev => prev === 'asc' ? 'desc' : 'asc') }}>
                              {new Date(o.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                              <span className='text-muted-foreground/60 ml-1'>{relativeTime(o.createdAt)}</span>
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='text-sm font-medium leading-tight'>{o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : (o.guestName || 'Guest')}</div>
                          <div className='flex items-center gap-1.5 mt-0.5'>
                            <a href={`tel:${o.customer?.phoneNumber || o.guestPhone}`} onClick={e => e.stopPropagation()} className='text-[11px] text-muted-foreground hover:text-primary transition-colors'>{o.customer?.phoneNumber || o.guestPhone || '—'}</a>
                            {(o.customer?.phoneNumber || o.guestPhone) && (
                              <button onClick={e => { e.stopPropagation(); copyToClipboard(o.customer?.phoneNumber || o.guestPhone || '', 'Phone') }} className='text-muted-foreground/50 hover:text-foreground transition-colors'><ClipboardCopy className='h-2.5 w-2.5' /></button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Select value={o.status.id} onValueChange={v => {
                            const s = statusList.find((s: any) => s.id === v)
                            if (s) { setStatusNote(''); setStatusDialog({ order: o, newStatusId: v, newStatusName: s.name }) }
                          }}>
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
                                const next = Array.isArray(o.status?.nextStatuses) ? o.status.nextStatuses : []
                                return s.id === o.status?.id || next.includes(s.id)
                              }).map((s: any) => (
                                <SelectItem key={s.id} value={s.id}>
                                  <span className='flex items-center gap-2'><span className='h-2 w-2 rounded-full shrink-0' style={{ backgroundColor: getStatusColor(s.name, s.color) }} />{s.name}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {o.courierService ? (
                            <div className='flex items-center gap-1.5'>
                              <Badge variant='outline' className='text-xs capitalize gap-1'><Truck className='h-2.5 w-2.5' /> {o.courierService}</Badge>
                              {o.trackingUrl && (
                                <button onClick={e => { e.stopPropagation(); window.open(o.trackingUrl || undefined, '_blank') }} className='text-muted-foreground hover:text-primary transition-colors' title='Track shipment'>
                                  <ExternalLink className='h-3 w-3' />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className='text-xs text-muted-foreground/50'>Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          {o.assignee ? (
                            <div className='flex items-center gap-1.5'>
                              <div className='h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0'>
                                {o.assignee.firstName?.[0]}{o.assignee.lastName?.[0]}
                              </div>
                              <span className='text-xs font-medium truncate max-w-[80px]'>{o.assignee.firstName} {o.assignee.lastName}</span>
                            </div>
                          ) : (
                            <span className='text-xs text-muted-foreground/50 italic'>Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className='text-right font-semibold text-sm'>৳{fmt(o.total)}</TableCell>
                        <TableCell className='text-right text-sm text-muted-foreground'>{o.items.length}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant='ghost' size='icon' className='h-7 w-7'><MoreHorizontal className='h-3.5 w-3.5' /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuItem asChild><Link to='/op/orders/$id' params={{ id: o.id }}><Eye className='h-4 w-4 mr-2' />View Details</Link></DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyToClipboard(o.displayId, 'Order ID')}><ClipboardCopy className='h-4 w-4 mr-2' />Copy Order ID</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => copyToClipboard(o.customer?.phoneNumber || o.guestPhone || '', 'Phone')}><Phone className='h-4 w-4 mr-2' />Copy Phone</DropdownMenuItem>
                              {formatAddressFull(addr) && <DropdownMenuItem onClick={() => copyToClipboard(formatAddressFull(addr), 'Address')}><MapPin className='h-4 w-4 mr-2' />Copy Address</DropdownMenuItem>}
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup className='px-2 py-1.5 text-xs text-muted-foreground'>
                                <div className='flex items-center gap-1.5 mb-1 font-medium text-foreground'><UserPlus className='h-3.5 w-3.5' />Assign to</div>
                                <div className='flex flex-col gap-0.5 max-h-32 overflow-y-auto'>
                                  <button onClick={() => { ordersApi.bulkAssign([o.id], null).then(() => { queryClient.invalidateQueries({ queryKey: ['orders'] }); toast.success('Unassigned') }) }} className='flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent transition-colors'>
                                    <span className='text-muted-foreground italic'>Unassign</span>
                                  </button>
                                  {staff.map((s: any) => (
                                    <button key={s.id} onClick={() => { ordersApi.bulkAssign([o.id], s.id).then(() => { queryClient.invalidateQueries({ queryKey: ['orders'] }); toast.success(`Assigned to ${s.firstName}`) }) }} className={`flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent transition-colors ${o.assignee?.id === s.id ? 'bg-accent font-medium' : ''}`}>
                                      <div className='h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold text-primary shrink-0'>{s.firstName?.[0]}{s.lastName?.[0]}</div>
                                      <span>{s.firstName} {s.lastName}</span>
                                    </button>
                                  ))}
                                </div>
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => window.open(`/admin/op/print/sticker/${o.id}`, '_blank')}><Printer className='h-4 w-4 mr-2' />Print Sticker</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => window.open(`/admin/op/print/invoice/${o.id}`, '_blank')}><Receipt className='h-4 w-4 mr-2' />Print Invoice</DropdownMenuItem>
                              {o.trackingUrl && <DropdownMenuItem onClick={() => window.open(o.trackingUrl || undefined, '_blank')}><ExternalLink className='h-4 w-4 mr-2' />Track Shipment</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>,
                      isExpanded && (
                        <TableRow key={`${o.id}-detail`} className='even:bg-muted/[0.02]'>
                          <TableCell colSpan={10} className='p-0 border-0'>
                            <div className='overflow-hidden' style={{ borderTop: `2px solid ${accentColor}` }}>
                              <div className='px-6 py-5 grid grid-cols-1 lg:grid-cols-5 gap-5'>
                                <div className='lg:col-span-3 space-y-3'>
                                  <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                                    <Package className='h-3.5 w-3.5' /> Products
                                    <span className='text-[10px] font-normal normal-case tracking-normal'>({o.items.length} item{o.items.length > 1 ? 's' : ''})</span>
                                  </div>
                                  <div className='space-y-1.5'>
                                    {o.items.map((item) => {
                                      const thumb = getProductThumb(item)
                                      const lineTotal = nn(item.price) * item.quantity
                                      return (
                                        <div key={item.id} className='flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 shadow-sm'>
                                          {thumb ? (
                                            <SafeImage src={thumb} alt={item.product?.name} className='h-11 w-11 rounded-md object-cover border shrink-0' thumbWidth={48} thumbHeight={48} />
                                          ) : (
                                            <div className='h-11 w-11 rounded-md border bg-muted/50 flex items-center justify-center shrink-0'>
                                              <Package className='h-4 w-4 text-muted-foreground/60' />
                                            </div>
                                          )}
                                          <div className='flex-1 min-w-0'>
                                            <div className='text-sm font-medium truncate leading-tight'>
                                              {item.product?.slug ? (
                                                <Link to='/op/products' className='hover:underline' onClick={e => e.stopPropagation()}>{item.product?.name || 'Unknown Product'}</Link>
                                              ) : (item.product?.name || 'Unknown Product')}
                                            </div>
                                            <div className='flex items-center gap-2.5 mt-0.5'>
                                              <span className='text-[11px] text-muted-foreground'>৳{fmt(item.price)} each</span>
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
                                          <span className='flex items-center gap-1'><Tag className='h-3 w-3' />Discount{o.discountType === 'percentage' ? ` (${fmt(o.discount)}%)` : ''}</span>
                                          <span className='font-medium'>-৳{fmt(o.discountType === 'percentage' ? nn(o.subtotal) * nn(o.discount) / 100 : o.discount)}</span>
                                        </div>
                                      )}
                                      <div className='flex justify-between font-bold text-base pt-2 border-t'><span>Total</span><span>৳{fmt(o.total)}</span></div>
                                    </div>
                                  </div>
                                </div>

                                <div className='lg:col-span-2 space-y-3'>
                                  <div className='flex items-center justify-between'>
                                    <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                                      <MapPin className='h-3.5 w-3.5' /> Shipping & Customer
                                    </div>
                                    {formatAddressFull(addr) && (
                                      <button onClick={() => copyToClipboard(formatAddressFull(addr), 'Address')} className='text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1'>
                                        <ClipboardCopy className='h-3 w-3' /> Copy
                                      </button>
                                    )}
                                  </div>
                                  <div className='rounded-lg border bg-background p-3.5 shadow-sm space-y-2.5'>
                                    <div className='font-medium text-sm'>
                                      {addr.name || (o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : o.guestName || 'Guest')}
                                    </div>
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
                                      {(o.customer?.phoneNumber || o.guestPhone) && (
                                        <div className='flex items-center gap-2 text-sm'>
                                          <Phone className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
                                          <a href={`tel:${o.customer?.phoneNumber || o.guestPhone}`} className='hover:underline'>{o.customer?.phoneNumber || o.guestPhone}</a>
                                          <button onClick={() => copyToClipboard(o.customer?.phoneNumber || o.guestPhone || '')} className='text-muted-foreground/50 hover:text-foreground transition-colors'><ClipboardCopy className='h-3 w-3' /></button>
                                        </div>
                                      )}
                                      {o.customer?.email && (
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

                                  {o.assignee && (
                                    <div className='rounded-lg border bg-background px-3 py-2 shadow-sm'>
                                      <div className='flex items-center gap-2'>
                                        <div className='h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0'>
                                          {o.assignee.firstName?.[0]}{o.assignee.lastName?.[0]}
                                        </div>
                                        <div>
                                          <div className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>Assigned To</div>
                                          <div className='text-sm font-medium'>{o.assignee.firstName} {o.assignee.lastName}</div>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {o.payments && o.payments.length > 0 && (
                                    <div className='space-y-1.5'>
                                      <div className='text-[11px] font-semibold text-muted-foreground uppercase tracking-wider'>Payments</div>
                                      {o.payments.map((p) => {
                                        const gw = p.gatewayCode || p.method
                                        const pm = paymentMethodLabel(gw)
                                        const ps = paymentStatusBadgeClass(p.status)
                                        return (
                                          <div key={p.id} className='flex items-center justify-between rounded-lg border bg-background px-3 py-2 shadow-sm'>
                                            <div className='flex items-center gap-2'>
                                              <CreditCard className={`h-3.5 w-3.5 ${pm.colorClass}`} />
                                              <span className='text-sm font-medium'>{pm.label}</span>
                                            </div>
                                            <div className='flex items-center gap-2'>
                                              <span className='text-sm font-semibold'>৳{fmt(p.amount)}</span>
                                              <Badge variant={ps.variant} className={`text-[10px] ${ps.className}`}>{p.status}</Badge>
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
                  }) : (
                    <TableRow><TableCell colSpan={10} className='p-0 border-0'><EmptyState search={search} statusFilter={statusFilter} onClear={clearAllFilters} /></TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
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
            <div className='flex items-center gap-2'>
              <SearchableSelect
                options={[
                  { id: 'unassigned', label: 'Unassign' },
                  ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() }))
                ]}
                value={''}
                onChange={(v) => { if (v) bulkAssignMut.mutate({ ids: selected, assignedToId: v }) }}
                placeholder='Assign to...'
                searchPlaceholder='Search staff...'
              />
              {selected.length > 0 && (
                <Button variant='outline' size='sm' className='h-8 text-xs text-muted-foreground' onClick={() => bulkAssignMut.mutate({ ids: selected, assignedToId: '__unassign__' })} title='Unassign all selected'>
                  <X className='h-3 w-3' />
                </Button>
              )}
            </div>
            <Button variant='outline' size='sm' onClick={() => { const ids = selected.join(','); window.open(`/admin/op/print/bulk?type=sticker&ids=${ids}`, '_blank') }}><Printer className='h-3.5 w-3.5 mr-1' /> Stickers</Button>
            <Button variant='outline' size='sm' onClick={() => { const ids = selected.join(','); window.open(`/admin/op/print/bulk?type=invoice&ids=${ids}`, '_blank') }}><Printer className='h-3.5 w-3.5 mr-1' /> Invoices</Button>
            <div className='flex items-center gap-1 border-l pl-3'>
              <Select value={dispatchCourier} onValueChange={setDispatchCourier}>
                <SelectTrigger className='h-8 w-[130px] text-xs'><SelectValue placeholder='Send to...' /></SelectTrigger>
                <SelectContent>
                  {activeCouriers.filter((c: any) => c.enabled).map((c: any) => (
                    <SelectItem key={c.courier} value={c.courier}>{c.courier.charAt(0).toUpperCase() + c.courier.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size='sm' className='h-8 text-xs' disabled={!dispatchCourier || dispatchMut.isPending} onClick={() => dispatchMut.mutate({ courier: dispatchCourier, ids: selected })}>
                {dispatchMut.isPending ? <Loader2 className='h-3 w-3 animate-spin mr-1' /> : <Send className='h-3 w-3 mr-1' />}
                Send
              </Button>
            </div>
          </div>
        )}

        <Dialog open={!!statusDialog} onOpenChange={o => { if (!o) setStatusDialog(null); setStatusNote('') }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Change Order Status</DialogTitle>
              <DialogDescription>
                Update status for <span className="font-mono font-medium">{statusDialog?.order.displayId}</span>
              </DialogDescription>
            </DialogHeader>
            {statusDialog && (
              <div className="space-y-4 py-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Current</p>
                    <p className="text-sm font-medium mt-0.5">{statusDialog.order.status.name}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">New</p>
                    <p className="text-sm font-medium mt-0.5">{statusDialog.newStatusName}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status-note">Note (optional)</Label>
                  <Textarea id="status-note" placeholder="Reason for this status change..." value={statusNote} onChange={e => setStatusNote(e.target.value)} rows={2} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setStatusDialog(null); setStatusNote('') }}>Cancel</Button>
              <Button onClick={() => {
                if (!statusDialog) return
                statusMut.mutate(
                  { id: statusDialog.order.id, statusId: statusDialog.newStatusId, note: statusNote || undefined },
                  { onSuccess: () => { setStatusDialog(null); setStatusNote('') } },
                )
              }} disabled={statusMut.isPending}>
                {statusMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Confirm Change
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}