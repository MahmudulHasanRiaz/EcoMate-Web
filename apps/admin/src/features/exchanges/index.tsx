import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { exchangesApi, deriveExchangeType, type ExchangeListItem } from './api'
import { apiClient } from '@/lib/api-client'
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
import { Loader2, ArrowRightLeft } from 'lucide-react'

interface LinkedReturn {
  id: string
  displayId: string
  status: string
  items: { productId: string; variantId?: string | null; quantity: number }[]
}

function useLinkedReturns(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['exchange-return', id],
      queryFn: () =>
        apiClient
          .get<{ data: LinkedReturn[] }>('/returns', { params: { exchangeOrderId: id } })
          .then((r) => r.data.data[0] ?? null),
      retry: false,
      staleTime: 60_000,
    })),
  })
}

function useOriginalItems(orderIds: (string | null | undefined)[], enabled: boolean[]) {
  return useQueries({
    queries: orderIds.map((oid, i) => ({
      queryKey: ['exchange-original-items', oid],
      queryFn: () =>
        apiClient
          .get<{ items: { productId: string; variantId?: string | null; quantity: number }[] }>(
            `/orders/${oid}`,
          )
          .then((r) => r.data.items ?? []),
      enabled: enabled[i] && !!oid,
      retry: false,
      staleTime: 60_000,
    })),
  })
}

/**
 * Exchanges list (Task 7): ORD + Exchange badge, original ORD link,
 * type Full/Partial (derived from the Return(EXCHANGE) leg vs the
 * original lines — '—' while unknown, never guessed), dispatch status,
 * order status, linked Return status, date. Filters status/type/date +
 * search; pagination; row → detail.
 */
export function ExchangesList() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [statusId, setStatusId] = useState('all')
  const [exType, setExType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const perPage = 10

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const { data: statuses } = useQuery({
    queryKey: ['order-statuses'],
    queryFn: () => apiClient.get('/order-statuses').then((r) => r.data as { id: string; name: string }[]),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['exchanges', debounced, statusId, dateFrom, dateTo, page],
    queryFn: () =>
      exchangesApi.list({
        search: debounced || undefined,
        statusId: statusId !== 'all' ? statusId : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        perPage,
      }),
  })

  const all: ExchangeListItem[] = data?.data ?? []
  const ids = useMemo(() => all.map((o) => o.id), [data])
  const linkedQs = useLinkedReturns(ids)
  const linkedById = useMemo(() => {
    const m = new Map<string, LinkedReturn | null>()
    ids.forEach((id, i) => m.set(id, (linkedQs[i]?.data as LinkedReturn | null) ?? null))
    return m
  }, [ids, linkedQs])

  const originalIds = useMemo(() => all.map((o) => o.exchangeOfOrderId), [data])
  const needOriginal = useMemo(
    () => all.map((o) => !!linkedById.get(o.id)),
    [all, linkedById],
  )
  const originalQs = useOriginalItems(originalIds, needOriginal)

  const typeById = useMemo(() => {
    const m = new Map<string, string>()
    ids.forEach((id, i) => {
      const linked = linkedById.get(id)
      if (!linked) {
        m.set(id, '—')
        return
      }
      const originalItems =
        (originalQs[i]?.data as { productId: string; variantId?: string | null; quantity: number }[] | undefined) ??
        []
      // While the original has not loaded yet, report '—' (never guessed).
      if (needOriginal[i] && originalQs[i]?.isLoading) {
        m.set(id, '—')
        return
      }
      m.set(id, deriveExchangeType(originalItems, linked.items ?? []))
    })
    return m
  }, [ids, linkedById, originalQs, needOriginal])

  const rows =
    exType === 'all' ? all : all.filter((o) => typeById.get(o.id) === exType)
  const total: number = data?.meta?.total ?? 0
  const totalPages = Math.max(1, data?.meta?.totalPages ?? 1)

  const selectCls = 'h-8.5 text-xs bg-background/80 border-border/60 shadow-2xs rounded-lg'

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <div className='flex items-center gap-2.5'>
          <ArrowRightLeft className='h-5 w-5 text-muted-foreground' />
          <h2 className='text-2xl font-bold tracking-tight'>Exchanges</h2>
          <span className='text-xs text-muted-foreground'>{total} total</span>
        </div>

        <div className='rounded-xl border border-border/70 bg-card/60 p-2.5 shadow-2xs'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              placeholder='Search exchanges…'
              aria-label='Search exchanges'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='h-8.5 text-xs max-w-xs bg-background/80 border-border/60 rounded-lg'
            />
            <Select value={statusId} onValueChange={(v) => { setStatusId(v); setPage(1) }}>
              <SelectTrigger className={selectCls}><SelectValue placeholder='Status' /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all' className='text-xs'>All statuses</SelectItem>
                {(Array.isArray(statuses) ? statuses : []).map((s) => (
                  <SelectItem key={s.id} value={s.id} className='text-xs'>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={exType} onValueChange={(v) => { setExType(v); setPage(1) }}>
              <SelectTrigger className={selectCls}><SelectValue placeholder='Type' /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all' className='text-xs'>All types</SelectItem>
                <SelectItem value='Full' className='text-xs'>Full</SelectItem>
                <SelectItem value='Partial' className='text-xs'>Partial</SelectItem>
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
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Order</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Original</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Type</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Dispatch</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Status</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Return</TableHead>
                    <TableHead className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow>
                  ) : rows.length ? rows.map((o) => {
                    const linked = linkedById.get(o.id)
                    return (
                      <TableRow key={o.id}>
                        <TableCell>
                          <div className='flex items-center gap-1.5'>
                            <Link to='/op/exchanges/$id' params={{ id: o.id }} className='font-mono text-xs font-bold text-primary hover:underline'>
                              {o.displayId}
                            </Link>
                            <span className='inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:text-violet-400'>
                              Exchange
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {o.exchangeOfOrder ? (
                            <Link to='/op/orders/$id' params={{ id: o.exchangeOfOrder.id }} className='font-mono text-xs text-primary hover:underline'>
                              {o.exchangeOfOrder.displayId}
                            </Link>
                          ) : <span className='text-xs text-muted-foreground'>—</span>}
                        </TableCell>
                        <TableCell className='text-xs'>{typeById.get(o.id) ?? '—'}</TableCell>
                        <TableCell className='text-xs'>
                          {o.dispatches?.[0] ? `${o.dispatches[0].courier} · ${o.dispatches[0].status}` : (o.courierService ?? '—')}
                        </TableCell>
                        <TableCell><Badge variant='outline' className='text-[11px]'>{o.status.name}</Badge></TableCell>
                        <TableCell>
                          {linked ? (
                            <Link to='/op/returns/$id' params={{ id: linked.id }} className='font-mono text-xs text-primary hover:underline'>
                              {linked.displayId}
                            </Link>
                          ) : <span className='text-xs text-muted-foreground'>—</span>}
                        </TableCell>
                        <TableCell className='text-[11px] text-muted-foreground'>
                          {new Date(o.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                        </TableCell>
                      </TableRow>
                    )
                  }) : (
                    <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>No exchanges found</TableCell></TableRow>
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
