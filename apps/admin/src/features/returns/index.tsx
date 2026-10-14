import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { returnsApi, type ReturnListItem } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, RotateCcw } from 'lucide-react'

const RETURN_STATUSES = ['REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'RESTOCKED', 'CLOSED']
const RETURN_TYPES = ['FULL', 'PARTIAL', 'EXCHANGE']
const RETURN_SOURCES = ['STAFF', 'COURIER', 'EXCHANGE']
const COURIERS = ['steadfast', 'pathao', 'redx', 'carrybee']

export function stockLabel(r: Pick<ReturnListItem, 'status' | 'stockReconciled'>): string {
  if (r.stockReconciled) return 'Restocked'
  if (r.status === 'RECEIVED') return 'Received'
  return 'Pending'
}

function itemsLabel(r: Pick<ReturnListItem, 'items'>): string {
  const n = (r.items ?? []).reduce((s, l) => s + Number((l as { quantity: number }).quantity ?? 0), 0)
  return `${n} pcs`
}

/**
 * Returns list (Task 7): RTN ID, original ORD link, type, status,
 * courier + courier return ID, items count, stock state, refund state,
 * created date. Filters status/type/source/courier/date + search;
 * pagination; row RTN → detail.
 */
export function ReturnsList() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [source, setSource] = useState('all')
  const [courier, setCourier] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const limit = 20

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: ['returns', debounced, status, type, source, courier, dateFrom, dateTo, page],
    queryFn: () =>
      returnsApi.list({
        search: debounced || undefined,
        status: status !== 'all' ? status : undefined,
        type: type !== 'all' ? type : undefined,
        source: source !== 'all' ? source : undefined,
        courier: courier !== 'all' ? courier : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit,
      }),
  })

  const rows: ReturnListItem[] = data?.data ?? []
  const total: number = data?.meta?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const selectCls = 'h-8.5 text-xs bg-background/80 border-border/60 shadow-2xs rounded-lg'

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-center gap-2.5'>
          <RotateCcw className='h-5 w-5 text-muted-foreground' />
          <h2 className='text-2xl font-bold tracking-tight'>Returns</h2>
          <span className='text-xs text-muted-foreground'>{total} total</span>
        </div>

        <div className='rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-2xs space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              placeholder='Search returns…'
              aria-label='Search returns'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='h-8.5 text-xs max-w-xs bg-background/80 border-border/60 rounded-lg'
            />
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
              <SelectTrigger className={selectCls}><SelectValue placeholder='Status' /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all' className='text-xs'>All statuses</SelectItem>
                {RETURN_STATUSES.map((s) => <SelectItem key={s} value={s} className='text-xs'>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1) }}>
              <SelectTrigger className={selectCls}><SelectValue placeholder='Type' /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all' className='text-xs'>All types</SelectItem>
                {RETURN_TYPES.map((s) => <SelectItem key={s} value={s} className='text-xs'>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={(v) => { setSource(v); setPage(1) }}>
              <SelectTrigger className={selectCls}><SelectValue placeholder='Source' /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all' className='text-xs'>All sources</SelectItem>
                {RETURN_SOURCES.map((s) => <SelectItem key={s} value={s} className='text-xs'>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={courier} onValueChange={(v) => { setCourier(v); setPage(1) }}>
              <SelectTrigger className={selectCls}><SelectValue placeholder='Courier' /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all' className='text-xs'>All couriers</SelectItem>
                {COURIERS.map((s) => <SelectItem key={s} value={s} className='text-xs capitalize'>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type='date'
              aria-label='From date'
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className='h-8.5 text-xs w-36 bg-background/80 border-border/60 rounded-lg'
            />
            <Input
              type='date'
              aria-label='To date'
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className='h-8.5 text-xs w-36 bg-background/80 border-border/60 rounded-lg'
            />
          </div>
        </div>

        <Card className='rounded-xl border border-border/70 bg-card shadow-2xs overflow-hidden'>
          <CardContent className='p-0'>
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader className='bg-muted/40 border-b border-border/70'>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>RTN ID</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Original Order</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Type</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Status</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Courier</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Items</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Stock</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Refund</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow>
                  ) : rows.length ? rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link to='/op/returns/$id' params={{ id: r.id }} className='font-mono text-xs font-bold text-primary hover:underline'>
                          {r.displayId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {r.order ? (
                          <Link to='/op/orders/$id' params={{ id: r.order.id }} className='font-mono text-xs text-primary hover:underline'>
                            {r.order.displayId}
                          </Link>
                        ) : <span className='font-mono text-xs text-muted-foreground'>{r.orderId.slice(0, 8)}</span>}
                      </TableCell>
                      <TableCell><Badge variant='outline' className='text-[11px]'>{r.type}</Badge></TableCell>
                      <TableCell><Badge variant='outline' className='text-[11px]'>{r.status}</Badge></TableCell>
                      <TableCell>
                        <div className='text-xs capitalize'>{r.courier ?? '—'}</div>
                        <div className='font-mono text-[11px] text-muted-foreground'>{r.courierReturnId ?? ''}</div>
                      </TableCell>
                      <TableCell className='text-xs'>{itemsLabel(r)}</TableCell>
                      <TableCell className='text-xs'>{stockLabel(r)}</TableCell>
                      <TableCell className='font-mono text-[11px] text-muted-foreground'>
                        {r.refundId ? r.refundId.slice(0, 8) : '—'}
                      </TableCell>
                      <TableCell className='text-[11px] text-muted-foreground'>
                        {new Date(r.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={9} className='text-center py-8 text-muted-foreground'>No returns found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className='flex items-center justify-end gap-2'>
          <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
          <span className='text-xs text-muted-foreground'>Page {page} of {totalPages}</span>
          <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </Main>
    </>
  )
}
