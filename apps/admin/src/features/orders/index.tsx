import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ordersApi } from './api'
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
import { Loader2, ExternalLink, Printer, X, ChevronLeft, ChevronRight, ArrowUpDown, Truck } from 'lucide-react'

const statusColors: Record<string, string> = { Pending: '#F59E0B', Confirmed: '#3B82F6', Cancelled: '#EF4444', 'On Hold': '#8B5CF6', Packed: '#06B6D4', Shipped: '#10B981', 'In Courier': '#6366F1', Delivered: '#22C55E', 'Partial Return': '#F97316', 'Return Pending': '#EC4899', Returned: '#DC2626', Damaged: '#991B1B' }
const nn = (v: number | string) => Number(v)
const fmt = (v: number | string) => nn(v).toFixed(2)

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
                {isLoading ? <TableRow><TableCell colSpan={10} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
                 data?.data?.length ? data.data.map((o: any) => (
                  <TableRow key={o.id} className={selected.includes(o.id) ? 'bg-muted/30' : ''}>
                    <TableCell><Checkbox checked={selected.includes(o.id)} onCheckedChange={() => toggleOne(o.id)} /></TableCell>
                    <TableCell className='font-mono text-sm font-medium'>
                      <Link to='/op/orders/$id' params={{ id: o.id }} className='hover:underline text-primary'>{o.displayId}</Link>
                    </TableCell>
                    <TableCell>
                      <div className='text-sm font-medium'>{o.customer.firstName} {o.customer.lastName}</div>
                      <div className='text-xs text-muted-foreground'>{o.customer.phoneNumber}</div>
                    </TableCell>
                    <TableCell>
                      <Select value={o.status.id} onValueChange={v => statusMut.mutate({ id: o.id, statusId: v })}>
                        <SelectTrigger className='h-7 w-[130px] text-xs border-0 bg-transparent hover:bg-muted' style={{ backgroundColor: statusColors[o.status.name] ? statusColors[o.status.name] + '20' : undefined }}>
                          <SelectValue>
                            <Badge style={{ backgroundColor: statusColors[o.status.name] || '#6B7280', color: '#fff' }} className='text-[11px]'>{o.status.name}</Badge>
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
                    <TableCell className='text-right font-medium text-sm'>৳{fmt(o.total)}</TableCell>
                    <TableCell className='text-right text-sm'>{o.items.length}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{new Date(o.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className='text-center'>
                      {o.trackingUrl ? <Button size='icon' variant='ghost' className='h-7 w-7' title='Track' onClick={e => { e.stopPropagation(); window.open(o.trackingUrl, '_blank') }}><ExternalLink className='h-3.5 w-3.5' /></Button> : <span className='text-xs text-muted-foreground'>—</span>}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-0.5'>
                        <Button size='icon' variant='ghost' className='h-7 w-7' title='Sticker' onClick={e => { e.stopPropagation(); window.open(`/admin/op/print/sticker/${o.id}`, '_blank') }}><Printer className='h-3.5 w-3.5' /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={10} className='text-center py-8 text-muted-foreground'>No orders found</TableCell></TableRow>}
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
