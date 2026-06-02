import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { SafeImage } from '@/components/safe-image'
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
import { Skeleton } from '@/components/ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  ChevronLeft, ChevronRight, Phone, MapPin, ShoppingCart,
  MoreHorizontal, Inbox, X, UserPlus, ArrowRightLeft, ChevronRight as ChevronRightIcon,
  Package, Edit3, Trash2,
} from 'lucide-react'

const statusColors: Record<string, string> = {
  PENDING: '#F59E0B',
  CONVERTED: '#22C55E',
  NOT_CONVERTED: '#6B7280',
  DELETED: '#EF4444',
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

function LeadRowSkeleton() {
  return (
    <TableRow>
      <TableCell><Skeleton className='h-4 w-4' /></TableCell>
      <TableCell><div className='space-y-1'><Skeleton className='h-4 w-28' /><Skeleton className='h-3 w-20' /></div></TableCell>
      <TableCell><Skeleton className='h-4 w-16' /></TableCell>
      <TableCell><Skeleton className='h-4 w-24' /></TableCell>
      <TableCell><Skeleton className='h-4 w-20' /></TableCell>
      <TableCell><Skeleton className='h-6 w-24 rounded-full' /></TableCell>
      <TableCell><Skeleton className='h-4 w-12' /></TableCell>
      <TableCell><Skeleton className='h-4 w-16' /></TableCell>
      <TableCell><Skeleton className='h-7 w-7' /></TableCell>
    </TableRow>
  )
}

interface Lead {
  id: string; displayId?: string | null; phone?: string | null; name?: string | null; email?: string | null;
  address?: any; items?: any; paymentMethod?: string | null;
  status: string; occurrences: number;
  firstSeenAt: string; lastSeenAt: string;
  assignedTo?: { id: string; firstName: string; lastName: string } | null;
  convertedBy?: { id: string; firstName: string; lastName: string } | null;
  convertedOrder?: { id: string; displayId: string } | null;
}

export function IncompleteLeads() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [editingLead, setEditingLead] = useState<Lead | null>(null)
  const [editForm, setEditForm] = useState<{
    guestName: string; guestPhone: string; paymentMethod: string;
    shippingAddress: string; items: any[];
  }>({ guestName: '', guestPhone: '', paymentMethod: '', shippingAddress: '', items: [] })

  useEffect(() => {
    if (editingLead) {
      setEditForm({
        guestName: editingLead.name || '',
        guestPhone: editingLead.phone || '',
        paymentMethod: editingLead.paymentMethod || 'cod',
        shippingAddress: editingLead.address ? JSON.stringify(editingLead.address) : '',
        items: (editingLead.items as any[])?.map(i => ({ ...i })) || [],
      })
    }
  }, [editingLead])

  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const { data: staffList } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => apiClient.get('/orders/staff/list').then(r => r.data as any[]),
  })
  const staff = (Array.isArray(staffList) ? staffList : []) as any[]

  const { data: summary } = useQuery({
    queryKey: ['checkout-leads-summary'],
    queryFn: () => apiClient.get('/checkout-leads/summary').then(r => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['checkout-leads', page, perPage, debouncedSearch, statusFilter, assigneeFilter],
    queryFn: () => apiClient.get('/checkout-leads', {
      params: {
        page, perPage,
        search: debouncedSearch || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        assignedToId: assigneeFilter !== 'all' ? assigneeFilter : undefined,
      },
    }).then(r => r.data),
  })

  const convertMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/checkout-leads/${id}/convert`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkout-leads'] }); toast.success('Lead converted to order') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Conversion failed'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/checkout-leads/${id}/status`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkout-leads'] }); toast.success('Status updated') },
  })

  const assignMut = useMutation({
    mutationFn: ({ id, assignedToId }: { id: string; assignedToId: string | null }) => apiClient.patch(`/checkout-leads/${id}/assign`, { assignedToId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkout-leads'] }); toast.success('Lead assigned') },
  })

  const bulkAssignMut = useMutation({
    mutationFn: ({ ids, assignedToId }: { ids: string[]; assignedToId: string | null }) => apiClient.post('/checkout-leads/bulk/assign', { ids, assignedToId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkout-leads'] }); setSelected([]); toast.success('Leads assigned') },
  })

  const bulkStatusMut = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) => apiClient.post('/checkout-leads/bulk/status', { ids, status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkout-leads'] }); setSelected([]); toast.success('Bulk status updated') },
  })

  const convertEditMut = useMutation({
    mutationFn: ({ id, overrides }: { id: string; overrides: any }) => apiClient.post(`/checkout-leads/${id}/convert`, overrides),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['checkout-leads'] }); setEditingLead(null); toast.success('Order created from lead') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Conversion failed'),
  })

  const leads = (data?.data || []) as Lead[]
  const total = data?.meta?.total || 0
  const totalPages = data?.meta?.totalPages || 1

  const toggleAll = () => { const ids = leads.map(l => l.id); setSelected(selected.length === ids.length ? [] : ids) }
  const toggleOne = (id: string) => setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id])
  const toggleExpand = (id: string) => setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const clearAllFilters = () => { setSearch(''); setStatusFilter('all'); setAssigneeFilter('all'); setPage(1) }
  const hasActiveFilters = search || statusFilter !== 'all' || assigneeFilter !== 'all'

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        {summary && (
          <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
            {[
              { key: 'PENDING', label: 'Pending', count: summary.pending, color: statusColors.PENDING },
              { key: 'CONVERTED', label: 'Converted', count: summary.converted, color: statusColors.CONVERTED },
              { key: 'NOT_CONVERTED', label: 'Not Converted', count: summary.notConverted, color: statusColors.NOT_CONVERTED },
              { key: 'DELETED', label: 'Deleted', count: summary.deleted, color: statusColors.DELETED },
            ].map(s => (
              <button key={s.key} onClick={() => { setStatusFilter(statusFilter === s.key ? 'all' : s.key); setPage(1) }}
                className={`relative overflow-hidden rounded-lg border p-3 text-left transition-all hover:shadow-sm ${statusFilter === s.key ? 'ring-2 ring-primary' : ''}`}>
                <div className='absolute top-0 left-0 w-1 h-full rounded-l-lg' style={{ backgroundColor: s.color }} />
                <div className='pl-2'>
                  <p className='text-xs text-muted-foreground'>{s.label}</p>
                  <p className='text-xl font-bold'>{s.count}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        <Card className='border-none shadow-sm bg-muted/40 dark:bg-muted/10 backdrop-blur-sm'>
          <CardContent className='p-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='relative w-[220px]'>
                <Input ref={searchInputRef} placeholder='Search name, phone...' value={search} onChange={e => setSearch(e.target.value)} className='h-9 text-sm pl-9 pr-7 bg-background/70 focus:bg-background border-none shadow-sm transition-colors' />
                {search && <button onClick={() => setSearch('')} className='absolute right-2 top-1/2 -translate-y-1/2 hover:text-foreground transition-colors'><X className='h-3.5 w-3.5 text-muted-foreground' /></button>}
              </div>
              <div className='w-[140px]'>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1) }}>
                  <SelectTrigger className='h-9 text-sm bg-background/70 focus:bg-background border-none shadow-sm'>
                    <SelectValue placeholder='Status' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>All Statuses</SelectItem>
                    {['PENDING', 'CONVERTED', 'NOT_CONVERTED', 'DELETED'].map(s => (
                      <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='w-[160px]'>
                <SearchableSelect
                  options={[
                    { id: 'all', label: 'All Staff' },
                    { id: 'unassigned', label: 'Unassigned' },
                    ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() })),
                  ]}
                  value={assigneeFilter}
                  onChange={(v) => { setAssigneeFilter(v || 'all'); setPage(1) }}
                  placeholder='Staff'
                  searchPlaceholder='Search staff...'
                  triggerClassName='h-9 text-sm bg-background/70 focus:bg-background border-none shadow-sm'
                />
              </div>
              <div className='w-[90px]'>
                <Select value={String(perPage)} onValueChange={v => { setPerPage(parseInt(v)); setPage(1) }}>
                  <SelectTrigger className='h-9 text-sm bg-background/70 focus:bg-background border-none shadow-sm'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <Button variant='ghost' size='sm' className='h-9 text-sm' onClick={clearAllFilters}>
                  <X className='h-4 w-4 mr-1.5' />Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-0'>
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader className='sticky top-0 bg-background z-10'>
                  <TableRow>
                    <TableHead className='w-10'><Checkbox checked={leads.length > 0 && selected.length === leads.length} onCheckedChange={toggleAll} /></TableHead>
                    <TableHead className='w-8'></TableHead>
                    <TableHead>Lead ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead className='w-10'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <><LeadRowSkeleton /><LeadRowSkeleton /><LeadRowSkeleton /></>
                  ) : leads.length > 0 ? leads.flatMap(l => {
                    const isExpanded = expanded.has(l.id)
                    const isSelected = selected.includes(l.id)
                    const accentColor = statusColors[l.status] || '#6B7280'
                    const itemsCount = (l.items as any[])?.length || 0
                    const cartTotal = (l.items as any[])?.reduce?.((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0) || 0
                    return [
                      <TableRow key={l.id} className={`${isSelected ? 'bg-muted/30' : 'even:bg-muted/[0.02]'} cursor-pointer transition-colors hover:bg-muted/50`}
                        onClick={() => toggleExpand(l.id)} style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}>
                        <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={isSelected} onCheckedChange={() => toggleOne(l.id)} /></TableCell>
                        <TableCell className='px-1'>
                          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRightIcon className='h-3.5 w-3.5 text-muted-foreground' />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className='text-xs font-mono font-medium'>{l.displayId || '—'}</div>
                        </TableCell>
                        <TableCell>
                          <div className='text-sm font-medium leading-tight'>{l.name || 'Unknown'}</div>
                          <div className='text-xs text-muted-foreground'>{l.phone || '—'}</div>
                        </TableCell>
                        <TableCell>
                          <div className='flex items-center gap-1.5 text-sm'>
                            <Phone className='h-3 w-3 text-muted-foreground shrink-0' />
                            <span className='text-xs'>{l.phone || '—'}</span>
                          </div>
                          {l.email && <div className='text-xs text-muted-foreground truncate max-w-[150px]'>{l.email}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge style={{ backgroundColor: accentColor + '20', color: accentColor, borderColor: accentColor + '40' }} className='text-xs font-medium border'>{l.status.replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell className='text-sm'>{itemsCount} item{itemsCount !== 1 ? 's' : ''} {l.occurrences > 1 && <span className='text-xs text-muted-foreground'>(x{l.occurrences})</span>}</TableCell>
                        <TableCell className='text-xs text-muted-foreground'>
                          {l.assignedTo ? (
                            <div className='flex items-center gap-1.5'>
                              <div className='h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold text-primary shrink-0'>
                                {l.assignedTo.firstName?.[0]}{l.assignedTo.lastName?.[0]}
                              </div>
                              <span>{l.assignedTo.firstName}</span>
                            </div>
                          ) : <span className='italic'>—</span>}
                        </TableCell>
                        <TableCell>
                          <div className='text-xs'>{new Date(l.lastSeenAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</div>
                          <div className='text-[10px] text-muted-foreground'>{relativeTime(l.lastSeenAt)}</div>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant='ghost' size='icon' className='h-7 w-7'><MoreHorizontal className='h-3.5 w-3.5' /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              {l.status === 'PENDING' && (
                                <DropdownMenuItem onClick={() => setEditingLead(l)}>
                                  <Edit3 className='h-4 w-4 mr-2' />Convert with Edit
                                </DropdownMenuItem>
                              )}
                              {l.status === 'PENDING' && (
                                <DropdownMenuItem onClick={() => convertMut.mutate(l.id)}>
                                  <ArrowRightLeft className='h-4 w-4 mr-2' />Quick Convert
                                </DropdownMenuItem>
                              )}
                              {l.status === 'PENDING' && (
                                <DropdownMenuItem onClick={() => statusMut.mutate({ id: l.id, status: 'NOT_CONVERTED' })}>
                                  <X className='h-4 w-4 mr-2' />Mark Not Converted
                                </DropdownMenuItem>
                              )}
                              {l.status !== 'DELETED' && (
                                <DropdownMenuItem onClick={() => statusMut.mutate({ id: l.id, status: 'DELETED' })}>
                                  <X className='h-4 w-4 mr-2' />Delete
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <div className='px-2 py-1.5'>
                                <p className='text-xs text-muted-foreground mb-1 flex items-center gap-1'><UserPlus className='h-3 w-3' />Assign to</p>
                                <div className='flex flex-col gap-0.5 max-h-32 overflow-y-auto'>
                                  <button onClick={() => assignMut.mutate({ id: l.id, assignedToId: null })} className='flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent transition-colors'>
                                    <span className='text-muted-foreground italic'>Unassign</span>
                                  </button>
                                  {staff.map((s: any) => (
                                    <button key={s.id} onClick={() => assignMut.mutate({ id: l.id, assignedToId: s.id })}
                                      className={`flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent transition-colors ${l.assignedTo?.id === s.id ? 'bg-accent font-medium' : ''}`}>
                                      <div className='h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold text-primary shrink-0'>{s.firstName?.[0]}{s.lastName?.[0]}</div>
                                      <span>{s.firstName} {s.lastName}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {l.convertedOrder && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem asChild>
                                    <Link to='/op/orders/$id' params={{ id: l.convertedOrder.id }}>
                                      <Package className='h-4 w-4 mr-2' />View Order
                                    </Link>
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>,
                      isExpanded && (
                        <TableRow key={`${l.id}-detail`} className='even:bg-muted/[0.02]'>
                          <TableCell colSpan={10} className='p-0 border-0'>
                            <div className='overflow-hidden' style={{ borderTop: `2px solid ${accentColor}` }}>
                              <div className='px-6 py-5 grid grid-cols-1 lg:grid-cols-2 gap-5'>
                                <div className='space-y-3'>
                                  <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                                    <ShoppingCart className='h-3.5 w-3.5' /> Cart Items ({itemsCount})
                                  </div>
                                  {Array.isArray(l.items) && l.items.length > 0 ? (
                                    <div className='space-y-1.5'>
                                      {l.items.map((item: any, idx: number) => (
                                        <div key={idx} className='flex items-center gap-3 rounded-lg border bg-background px-3 py-2 shadow-sm'>
                                          {item.image ? (
                                            <SafeImage src={item.image} alt={item.name} className='h-10 w-10 rounded-md object-cover border shrink-0' />
                                          ) : (
                                            <div className='h-10 w-10 rounded-md border bg-muted/50 flex items-center justify-center shrink-0'>
                                              <Package className='h-4 w-4 text-muted-foreground/60' />
                                            </div>
                                          )}
                                          <div className='flex-1 min-w-0'>
                                            <div className='text-sm font-medium truncate'>{item.name || 'Unknown Product'}</div>
                                            <div className='text-xs text-muted-foreground'>৳{Number(item.price || 0).toFixed(2)} × {item.quantity || 1}</div>
                                          </div>
                                          <div className='text-sm font-semibold'>৳{((item.price || 0) * (item.quantity || 1)).toFixed(2)}</div>
                                        </div>
                                      ))}
                                      <div className='text-right text-sm font-semibold pt-2 border-t'>Cart Total: ৳{cartTotal.toFixed(2)}</div>
                                    </div>
                                  ) : (
                                    <p className='text-sm text-muted-foreground italic'>No cart items captured</p>
                                  )}
                                </div>
                                <div className='space-y-3'>
                                  <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                                    <MapPin className='h-3.5 w-3.5' /> Details
                                  </div>
                                  <div className='rounded-lg border bg-background p-3.5 shadow-sm space-y-2.5'>
                                    <div className='font-medium text-sm'>{l.name || 'No name'}</div>
                                    <div className='flex items-center gap-2 text-sm'>
                                      <Phone className='h-3.5 w-3.5 text-muted-foreground shrink-0' />
                                      <span>{l.phone || '—'}</span>
                                    </div>
                                    {l.address && typeof l.address === 'object' && (
                                      <div className='text-sm text-muted-foreground'>
                                        {l.address.district && <span>{l.address.district}</span>}
                                        {l.address.thana && <span>, {l.address.thana}</span>}
                                        {l.address.address && <div className='mt-1'>{l.address.address}</div>}
                                      </div>
                                    )}
                                    {l.paymentMethod && (
                                      <div className='text-sm'>Payment: <span className='font-medium capitalize'>{l.paymentMethod.replace('_', ' ')}</span></div>
                                    )}
                                    <div className='text-xs text-muted-foreground'>
                                      First seen: {new Date(l.firstSeenAt).toLocaleString()}<br />
                                      Last seen: {new Date(l.lastSeenAt).toLocaleString()}<br />
                                      Occurrences: {l.occurrences}
                                    </div>
                                    {l.assignedTo && (
                                      <div className='flex items-center gap-2 text-sm pt-2 border-t'>
                                        <div className='h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0'>
                                          {l.assignedTo.firstName?.[0]}{l.assignedTo.lastName?.[0]}
                                        </div>
                                        <span>Assigned to {l.assignedTo.firstName} {l.assignedTo.lastName}</span>
                                      </div>
                                    )}
                                    {l.convertedOrder && (
                                      <div className='text-sm pt-2 border-t'>
                                        <span className='text-green-600 font-medium'>Converted to </span>
                                        <Link to='/op/orders/$id' params={{ id: l.convertedOrder.id }} className='font-mono text-primary hover:underline'>
                                          {l.convertedOrder.displayId}
                                        </Link>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ),
                    ].filter(Boolean)
                  }) : (
                    <TableRow><TableCell colSpan={10} className='p-0 border-0'>
                      <div className='flex flex-col items-center justify-center py-16 px-4'>
                        <div className='h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4'>
                          <Inbox className='h-8 w-8 text-muted-foreground' />
                        </div>
                        <h3 className='text-lg font-semibold mb-1'>No leads found</h3>
                        <p className='text-sm text-muted-foreground text-center max-w-sm'>
                          {hasActiveFilters ? 'No leads match your filters.' : 'No checkout abandonment captured yet.'}
                        </p>
                      </div>
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className='flex items-center justify-between'>
            <span className='text-sm text-muted-foreground'>Page {page} of {totalPages} ({total} leads)</span>
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
            <Select onValueChange={v => bulkStatusMut.mutate({ ids: selected, status: v })}>
              <SelectTrigger className='h-8 w-[160px] text-sm'><SelectValue placeholder='Change Status' /></SelectTrigger>
              <SelectContent>
                {['NOT_CONVERTED', 'DELETED'].map(s => (
                  <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchableSelect
              options={[
                { id: 'unassigned', label: 'Unassign' },
                ...staff.map((s: any) => ({ id: s.id, label: `${s.firstName} ${s.lastName}`.trim() })),
              ]}
              value={''}
              onChange={(v) => { if (v) bulkAssignMut.mutate({ ids: selected, assignedToId: v }) }}
              placeholder='Assign to...'
              searchPlaceholder='Search staff...'
            />
            <Button variant='outline' size='sm' onClick={() => bulkAssignMut.mutate({ ids: selected, assignedToId: null })} title='Unassign all'>
              <X className='h-3 w-3' />
            </Button>
          </div>
        )}
      </Main>

      <Dialog open={!!editingLead} onOpenChange={(open) => { if (!open) setEditingLead(null) }}>
        <DialogContent className='max-w-3xl max-h-[85vh] overflow-y-auto'>
          <DialogHeader><DialogTitle>Convert Lead {editingLead?.displayId || ''} to Order</DialogTitle></DialogHeader>
          {editingLead && (
            <div className='space-y-5 py-2'>
              <div className='grid grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Customer Name</Label>
                  <Input value={editForm.guestName} onChange={e => setEditForm(f => ({ ...f, guestName: e.target.value }))} />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Phone</Label>
                  <Input value={editForm.guestPhone} onChange={e => setEditForm(f => ({ ...f, guestPhone: e.target.value }))} />
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Payment Method</Label>
                  <Select value={editForm.paymentMethod} onValueChange={v => setEditForm(f => ({ ...f, paymentMethod: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='cod'>Cash On Delivery</SelectItem>
                      <SelectItem value='bkash'>bKash</SelectItem>
                      <SelectItem value='nagad'>Nagad</SelectItem>
                      <SelectItem value='rocket'>Rocket</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Shipping Address</Label>
                  <Textarea value={editForm.shippingAddress} onChange={e => setEditForm(f => ({ ...f, shippingAddress: e.target.value }))} rows={2} />
                </div>
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label className='text-xs font-semibold'>Order Items</Label>
                  <span className='text-xs text-muted-foreground'>
                    Total: ৳{editForm.items.reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0).toFixed(2)}
                  </span>
                </div>
                <div className='space-y-2 max-h-60 overflow-y-auto'>
                  {editForm.items.map((item: any, idx: number) => (
                    <div key={idx} className='flex items-center gap-2 rounded-lg border bg-background p-2'>
                      {item.image ? (
                        <SafeImage src={item.image} alt='' className='h-10 w-10 rounded object-cover shrink-0' />
                      ) : (
                        <div className='h-10 w-10 rounded border bg-muted/30 flex items-center justify-center shrink-0'>
                          <Package className='h-4 w-4 text-muted-foreground/60' />
                        </div>
                      )}
                      <div className='flex-1 min-w-0'>
                        <div className='text-sm font-medium truncate'>{item.name || 'Product'}</div>
                        <div className='flex items-center gap-2 mt-1'>
                          <Input type='number' value={item.quantity} onChange={e => {
                            const items = [...editForm.items]; items[idx] = { ...items[idx], quantity: parseInt(e.target.value) || 0 }; setEditForm(f => ({ ...f, items }))
                          }} className='h-7 w-16 text-xs' min={1} />
                          <Input type='number' value={item.price} onChange={e => {
                            const items = [...editForm.items]; items[idx] = { ...items[idx], price: parseFloat(e.target.value) || 0 }; setEditForm(f => ({ ...f, items }))
                          }} className='h-7 w-20 text-xs' step='any' min={0} />
                          <span className='text-xs font-medium w-16 text-right'>৳{((item.price || 0) * (item.quantity || 1)).toFixed(2)}</span>
                        </div>
                      </div>
                      <Button variant='ghost' size='icon' className='h-7 w-7 shrink-0 text-red-500' onClick={() => setEditForm(f => ({ ...f, items: f.items.filter((_: any, i: number) => i !== idx) }))}>
                        <Trash2 className='h-3.5 w-3.5' />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className='gap-2'>
            <Button variant='outline' onClick={() => setEditingLead(null)}>Cancel</Button>
            <Button onClick={() => editingLead && convertEditMut.mutate({
              id: editingLead.id,
              overrides: {
                items: editForm.items,
                guestName: editForm.guestName,
                guestPhone: editForm.guestPhone,
                paymentMethod: editForm.paymentMethod,
                shippingAddress: editForm.shippingAddress ? JSON.parse(editForm.shippingAddress) : undefined,
              },
            })} disabled={convertEditMut.isPending || editForm.items.length === 0}>
              {convertEditMut.isPending ? 'Creating...' : 'Create Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
