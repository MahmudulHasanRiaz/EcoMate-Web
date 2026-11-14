import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { History, Loader2, Play, RefreshCw } from 'lucide-react'
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { healthTone, storesApi } from './api'
import { useStoreDetail, useStoreHealth, STORES_KEYS } from './hooks'
import { CapabilityNotice } from './components/capability-notice'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { handleServerError } from '@/lib/handle-server-error'
import { apiClient } from '@/lib/api-client'
import { productsApi, type ProductResponse } from '@/features/products/api'
import { ordersApi, type OrderResponse } from '@/features/orders/api'
import { distributionApi, availabilitySourceLabel } from './distribution-api'
import {
  failureSummary,
  runStatusTone,
  syncApi,
  type OverrideAuditItem,
  type SyncIssueResponse,
  type SyncRunResponse,
} from './sync-api'
import {
  SYNC_KEYS,
  useProductHistory,
  useStoreOverridesHistory,
  useStoreSyncAttempts,
  useStoreSyncIssues,
  useStoreSyncRuns,
} from './sync-hooks'
import { SyncRunDetail } from './sync-center'
import { StoreReconnectDialog } from './store-reconnect-dialog'

const TABS = ['Overview', 'Products', 'Orders', 'Synchronization', 'Settings', 'Activity'] as const

/**
 * Store detail (§11): Overview · Products · Orders · Synchronization ·
 * Settings · Activity. Overview + Settings shells stay as they were;
 * Products/Orders/Synchronization/Activity are live server-backed surfaces
 * over the verified P4/P6/P11 contracts (no backend changes here).
 */
export function ChannelStoreDetail() {
  const { id } = useParams({ strict: false }) as { id: string }
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview')
  const [rotateOpen, setRotateOpen] = useState(false)
  const { data: store, isLoading } = useStoreDetail(id)
  const { data: health } = useStoreHealth(id)

  async function handleProbe() {
    try {
      const result = await storesApi.testConnection(id)
      toast.success(result.authenticated ? 'Connection verified' : 'Probe recorded — not authenticated')
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.detail(id) })
      queryClient.invalidateQueries({ queryKey: STORES_KEYS.health(id) })
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Probe failed')
    }
  }

  return (
    <>
      <StoreReconnectDialog
        store={rotateOpen && store ? store : null}
        onClose={() => setRotateOpen(false)}
      />
      <Header fixed>
        <h1 className="font-semibold">{store?.name ?? 'Store'}</h1>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {store && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{store.kind}</Badge>
              <Badge>{store.status}</Badge>
              <Badge variant={healthTone(store.healthState) as never}>{store.healthState}</Badge>
              <Button variant="outline" size="sm" onClick={handleProbe}>
                <RefreshCw className="mr-2 h-3 w-3" /> Test Connection
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <Button key={t} variant={tab === t ? 'default' : 'ghost'} size="sm" onClick={() => setTab(t)}>
                  {t}
                </Button>
              ))}
            </div>
            {tab === 'Overview' && (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div>Domain: {store.domainNormalised ?? '—'}</div>
                    <div>Provider store id: {store.providerStoreId ?? '—'}</div>
                    <div>Plugin: {store.pluginVersion ?? 'not reported'}</div>
                    <div>Last health check: {store.lastHealthCheckAt ?? '—'}</div>
                    <div>Last error: {store.lastError ?? '—'}</div>
                    {health && <div>Probe: {health.reason ?? health.state} ({health.checkedAt})</div>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Capabilities</CardTitle></CardHeader>
                  <CardContent>
                    <CapabilityNotice capabilities={store.capabilities} />
                    {!store.capabilities && <p className="text-sm text-muted-foreground">Run Test Connection to discover capabilities.</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Rotate credentials</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Replace credentials with the provider-specific form (keeps identity, mappings and history).
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setRotateOpen(true)}>Rotate…</Button>
                  </CardContent>
                </Card>
              </div>
            )}
            {tab === 'Products' && <StoreProductsTab storeId={id} />}
            {tab === 'Orders' && <StoreOrdersTab storeId={id} />}
            {tab === 'Synchronization' && <StoreSyncTab storeId={id} />}
            {tab === 'Activity' && <StoreActivityTab storeId={id} />}
            {tab === 'Settings' && (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Settings for this store lands with distribution (P3).
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </Main>
    </>
  )
}

// ─── Products: assigned-products table for this store ───────────────────────
// Server paginates products; per-row availability resolves through the
// verified GET /products/:id/store-availability contract (one row of that
// matrix belongs to this store). There is no per-product sync endpoint, so
// the per-row action is the verified product-history Sheet (mapping + field
// states + recent sync items) plus a link to the product. Global-only NATIVE
// rows resolve through the same matrix (BR-20).

interface ProductAvailabilityCell {
  effective: boolean
  source: string
  globalActive: boolean
  loading: boolean
}

function StoreProductsTab({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient()
  void queryClient
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [historyProduct, setHistoryProduct] = useState<ProductResponse | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['products', 'store', storeId, page, perPage, debounced],
    queryFn: () =>
      productsApi
        .list({ page, perPage, search: debounced || undefined, status: 'active' })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  })

  const products = useMemo(() => data?.data ?? [], [data])
  const total = data?.meta?.total ?? 0
  const totalPages = data?.meta?.totalPages ?? 1

  // One verified availability matrix per visible product; the cell for this
  // store is extracted below. Bounded by the page size (≤50).
  const availabilityQueries = useQueries({
    queries: products.map((p) => ({
      queryKey: ['distribution', 'availability', p.id] as const,
      queryFn: () => distributionApi.getAvailability(p.id),
      staleTime: 30_000,
    })),
  })

  const cellByProduct = useMemo(() => {
    const map = new Map<string, ProductAvailabilityCell>()
    products.forEach((p, i) => {
      const q = availabilityQueries[i]
      const row = q?.data?.stores?.find((s) => s.storeId === storeId)
      map.set(p.id, {
        effective: row?.effective ?? false,
        source: row ? availabilitySourceLabel(row) : '—',
        globalActive: q?.data?.globalActive ?? (p.status !== 'draft' && p.isActive),
        loading: !!q?.isLoading,
      })
    })
    return map
  }, [products, availabilityQueries, storeId])

  const columns = useMemo<ColumnDef<ProductResponse>[]>(() => [
    {
      accessorKey: 'name',
      header: 'Product',
      cell: ({ row }) => (
        <Link
          to="/op/products/$id"
          params={{ id: row.original.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'sku',
      header: 'SKU',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.sku ?? '—'}</span>
      ),
    },
    {
      id: 'global',
      header: 'Global',
      cell: ({ row }) => {
        const cell = cellByProduct.get(row.original.id)
        if (cell?.loading) return <span className="text-xs text-muted-foreground">…</span>
        return cell?.globalActive
          ? <Badge variant="success" asChild={false}>Active</Badge>
          : <Badge variant="secondary">Off</Badge>
      },
    },
    {
      id: 'availability',
      header: 'On this store',
      cell: ({ row }) => {
        const cell = cellByProduct.get(row.original.id)
        if (cell?.loading) return <span className="text-xs text-muted-foreground">Loading…</span>
        return (
          <div className="flex flex-col gap-1">
            {cell?.effective
              ? <Badge variant="success">Available</Badge>
              : <Badge variant="secondary">Off</Badge>}
            <span className="text-xs text-muted-foreground">{cell?.source ?? '—'}</span>
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setHistoryProduct(row.original)}>
            <History className="mr-1 h-3 w-3" /> History
          </Button>
          <Link to="/op/products/$id" params={{ id: row.original.id }}>
            <Button size="sm" variant="ghost">Open</Button>
          </Link>
        </div>
      ),
    },
  ], [cellByProduct])

  const table = useReactTable({
    data: products,
    columns,
    // Server-backed facet: products paginate on the server (?page&?perPage);
    // the table renders exactly the server page.
    manualPagination: true,
    pageCount: totalPages,
    state: { pagination: { pageIndex: page - 1, pageSize: perPage } },
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function'
        ? updater({ pageIndex: page - 1, pageSize: perPage })
        : updater
      setPage(next.pageIndex + 1)
      setPerPage(next.pageSize)
    },
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Products on this store</CardTitle>
            <CardDescription>
              {total} active product{total === 1 ? '' : 's'} · availability resolves per product (§8.2).
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-52"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
            </div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((r) => (
                    <TableRow key={r.id}>
                      {r.getVisibleCells().map((c) => (
                        <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No products found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </Button>
            <span>Page {page} of {totalPages}{isFetching ? ' · refreshing…' : ''}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
            <SearchableSelect
              options={[
                { id: '10', label: '10 / page' },
                { id: '20', label: '20 / page' },
                { id: '50', label: '50 / page' },
              ]}
              value={String(perPage)}
              onChange={(v) => { setPerPage(Number(v) || 10); setPage(1) }}
              placeholder="Rows per page"
              className="w-36"
            />
          </div>
        </CardContent>
      </Card>

      <Sheet open={historyProduct !== null} onOpenChange={(v) => { if (!v) setHistoryProduct(null) }}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Sync history — {historyProduct?.name ?? ''}</SheetTitle>
            <SheetDescription>Store mapping, field ownership and recent sync items (read-only).</SheetDescription>
          </SheetHeader>
          {historyProduct && <ProductHistoryBody storeId={storeId} productId={historyProduct.id} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

function ProductHistoryBody({ storeId, productId }: { storeId: string; productId: string }) {
  const { data, isLoading } = useProductHistory(storeId, productId)
  if (isLoading) return <p className="pt-4 text-sm text-muted-foreground">Loading history…</p>
  const payload = (data ?? {}) as {
    mapping?: { externalId?: string | null; externalUrl?: string | null } | null
    states?: { field: string; ownership: string; evidence?: string | null; lastPushedAt?: string | null }[]
    items?: { id: string; status: string; objectType: string; field?: string | null; reason?: string | null; createdAt: string }[]
  }
  return (
    <div className="space-y-3 pt-4 text-sm">
      <div>
        <span className="font-medium">External id: </span>
        <span className="font-mono text-xs">{payload.mapping?.externalId ?? '—'}</span>
      </div>
      {payload.mapping?.externalUrl && (
        <div className="break-all text-xs text-muted-foreground">{payload.mapping.externalUrl}</div>
      )}
      <div>
        <div className="mb-1 font-medium">Field states ({(payload.states ?? []).length})</div>
        {(payload.states ?? []).length === 0 && <p className="text-muted-foreground">No field states recorded.</p>}
        {(payload.states ?? []).slice(0, 50).map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 border-b py-1 last:border-0">
            <Badge variant="outline">{s.ownership}</Badge>
            <span className="font-mono text-xs">{s.field}</span>
            <span className="text-xs text-muted-foreground">
              {s.evidence ?? ''}{s.lastPushedAt ? ` · pushed ${new Date(s.lastPushedAt).toLocaleString()}` : ''}
            </span>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-1 font-medium">Recent sync items ({(payload.items ?? []).length})</div>
        {(payload.items ?? []).length === 0 && <p className="text-muted-foreground">No sync items for this product on this store.</p>}
        {(payload.items ?? []).slice(0, 50).map((item) => (
          <details key={item.id} className="border-b py-1 text-sm last:border-0">
            <summary className="cursor-pointer">
              <Badge variant="outline" className="mr-2">{item.status}</Badge>
              {item.objectType}{item.field ? ` · ${item.field}` : ''}
            </summary>
            <p className="mt-1 text-muted-foreground">{item.reason ?? '—'}</p>
          </details>
        ))}
      </div>
    </div>
  )
}

// ─── Orders: this store's orders (server filter storeId) ────────────────────

function StoreOrdersTab({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const { data: statuses } = useQuery({
    queryKey: ['order-statuses'],
    queryFn: () => apiClient.get('/order-statuses').then((r) => r.data as { id: string; name: string }[]),
  })
  const statusOptions = useMemo(() => [
    { id: 'all', label: 'All statuses' },
    ...((Array.isArray(statuses) ? statuses : []).map((s) => ({ id: s.id, label: s.name }))),
  ], [statuses])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['orders', 'store', storeId, page, perPage, debounced, statusFilter],
    queryFn: () =>
      ordersApi
        .list({
          page,
          perPage,
          search: debounced || undefined,
          statusId: statusFilter !== 'all' ? statusFilter : undefined,
          storeId,
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
  })

  const orders = useMemo(() => (data?.data ?? []) as OrderResponse[], [data])
  const total = data?.meta?.total ?? 0
  const totalPages = data?.meta?.totalPages ?? 1

  async function handleSyncOrders() {
    setSyncing(true)
    try {
      const res = await syncApi.reconcileOrders(storeId)
      toast.success(`Order reconcile started (run ${res.runId})`)
      queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs })
      queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runsByStore(storeId) })
    } catch (e: unknown) {
      handleServerError(e)
    } finally {
      setSyncing(false)
    }
  }

  const columns = useMemo<ColumnDef<OrderResponse>[]>(() => [
    {
      accessorKey: 'displayId',
      header: 'Order',
      cell: ({ row }) => (
        <div>
          <Link
            to="/op/orders/$id"
            params={{ id: row.original.id }}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.displayId}
          </Link>
          {row.original.externalOrderId && (
            <div className="font-mono text-[11px] text-muted-foreground">ext: {row.original.externalOrderId}</div>
          )}
        </div>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      cell: ({ row }) => {
        const o = row.original
        const name = o.customer ? `${o.customer.firstName} ${o.customer.lastName}`.trim() : (o.guestName ?? '—')
        const phone = o.customer?.phoneNumber ?? o.guestPhone ?? ''
        return (
          <div className="text-sm">
            <div className="font-medium">{name || '—'}</div>
            {phone && <div className="text-xs text-muted-foreground">{phone}</div>}
          </div>
        )
      },
    },
    {
      accessorKey: 'total',
      header: () => <div className="text-right">Total</div>,
      cell: ({ row }) => <div className="text-right text-sm">৳{Number(row.original.total).toFixed(2)}</div>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge style={{ backgroundColor: row.original.status?.color || '#6B7280', color: '#fff' }}>
          {row.original.status?.name ?? '—'}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Placed',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{new Date(row.original.createdAt).toLocaleString()}</span>
      ),
    },
  ], [])

  const table = useReactTable({
    data: orders,
    columns,
    // Server-backed facet: storeId + page + search filter on the server.
    manualPagination: true,
    pageCount: totalPages,
    state: { pagination: { pageIndex: page - 1, pageSize: perPage } },
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function'
        ? updater({ pageIndex: page - 1, pageSize: perPage })
        : updater
      setPage(next.pageIndex + 1)
      setPerPage(next.pageSize)
    },
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Orders from this store</CardTitle>
          <CardDescription>{total} order{total === 1 ? '' : 's'} ingested from this store (server filter storeId).</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/op/channels/sync-center">
            <Button size="sm" variant="ghost">Sync Center</Button>
          </Link>
          <Button size="sm" variant="outline" disabled={syncing} onClick={handleSyncOrders}>
            {syncing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            Sync orders now
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search orders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-52"
          />
          <SearchableSelect
            options={statusOptions}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v || 'all'); setPage(1) }}
            placeholder="Status"
            className="w-48"
          />
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading orders…
          </div>
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((r) => (
                  <TableRow key={r.id}>
                    {r.getVisibleCells().map((c) => (
                      <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No orders from this store yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </Button>
          <span>Page {page} of {totalPages}{isFetching ? ' · refreshing…' : ''}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Synchronization: this store's runs + three manual triggers ────────────

function formatDuration(run: SyncRunResponse): string {
  if (!run.finishedAt) return 'running…'
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StoreSyncTab({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient()
  const { data: runs, isLoading } = useStoreSyncRuns(storeId)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [pending, setPending] = useState<'PRODUCT' | 'ORDERS' | 'STOCK' | null>(null)

  const list = useMemo(() => runs ?? [], [runs])
  const productRunning = list.some((r) => r.status === 'RUNNING' && (r.scope === 'PRODUCT' || r.scope === 'PUBLISH'))
  const ordersRunning = list.some((r) => r.status === 'RUNNING' && (r.scope === 'RECONCILE' || r.scope === 'ORDER_INGEST'))
  const stockRunning = list.some((r) => r.status === 'RUNNING' && r.scope === 'STOCK')

  function invalidateRuns() {
    queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runs })
    queryClient.invalidateQueries({ queryKey: SYNC_KEYS.runsByStore(storeId) })
  }

  async function handleSyncProducts() {
    setPending('PRODUCT')
    try {
      const res = await syncApi.triggerStoreSync(storeId, 'PRODUCT')
      toast.success(`Product sync started (run ${res.runId})`)
      invalidateRuns()
    } catch (e: unknown) {
      handleServerError(e)
    } finally {
      setPending(null)
    }
  }

  async function handleSyncOrders() {
    setPending('ORDERS')
    try {
      const res = await syncApi.reconcileOrders(storeId)
      toast.success(`Order reconcile started (run ${res.runId})`)
      invalidateRuns()
    } catch (e: unknown) {
      handleServerError(e)
    } finally {
      setPending(null)
    }
  }

  async function handleSyncStock() {
    setPending('STOCK')
    try {
      const res = await syncApi.stockSync(storeId)
      toast.success(`Stock sync started (run ${res.runId})`)
      invalidateRuns()
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 404) {
        toast.error('Stock sync is not available yet (backend still deploying) — try again shortly')
      } else {
        handleServerError(e)
      }
    } finally {
      setPending(null)
    }
  }

  const columns = useMemo<ColumnDef<SyncRunResponse>[]>(() => [
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <Badge variant={runStatusTone(row.original.status) as never}>{row.original.status}</Badge>,
    },
    {
      accessorKey: 'scope',
      header: 'Scope',
      cell: ({ row }) => <span className="text-sm">{row.original.scope}</span>,
    },
    {
      accessorKey: 'triggerType',
      header: 'Trigger',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.triggerType}</span>,
    },
    {
      accessorKey: 'startedAt',
      header: 'Started',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{new Date(row.original.startedAt).toLocaleString()}</span>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDuration(row.original)}</span>,
    },
    {
      id: 'actions',
      header: () => <div className="text-right">Detail</div>,
      cell: ({ row }) => (
        <div className="text-right">
          <Button size="sm" variant="outline" onClick={() => setDetailId(row.original.id)}>Detail</Button>
        </div>
      ),
    },
  ], [])

  const table = useReactTable({
    data: list,
    columns,
    // Server-backed facet: the store filter is a server query (?storeId=);
    // the run list for one store is complete, rendered as a single page.
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Synchronization</CardTitle>
          <CardDescription>
            Manual triggers return a run id immediately; heavy work runs in the worker (BR-21).
            Runs poll every 5s while one is RUNNING, 30s otherwise.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={productRunning || pending === 'PRODUCT'}
              onClick={handleSyncProducts}
            >
              {(pending === 'PRODUCT' || productRunning) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Sync products
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={ordersRunning || pending === 'ORDERS'}
              onClick={handleSyncOrders}
            >
              {(pending === 'ORDERS' || ordersRunning) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Sync orders
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={stockRunning || pending === 'STOCK'}
              onClick={handleSyncStock}
            >
              {(pending === 'STOCK' || stockRunning) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Sync stock only
            </Button>
            <Link to="/op/channels/sync-center">
              <Button size="sm" variant="ghost">Open Sync Center</Button>
            </Link>
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
            </div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((r) => {
                    const run = r.original
                    const failed = run.status === 'FAILED' || run.status === 'PARTIAL'
                    return (
                      <TableRow key={r.id}>
                        {r.getVisibleCells().map((c) => (
                          <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                        ))}
                        {failed && (
                          <TableCell colSpan={6} className="hidden">
                            {failureSummary(run).sentence}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No sync runs for this store yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          {list.filter((r) => r.status === 'FAILED' || r.status === 'PARTIAL').map((run) => (
            <p key={run.id} className="text-sm text-muted-foreground">
              <Badge variant={runStatusTone(run.status) as never} className="mr-2">{run.status}</Badge>
              {failureSummary(run).sentence}
            </p>
          ))}
        </CardContent>
      </Card>

      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null) }}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader><SheetTitle>Sync run detail</SheetTitle></SheetHeader>
          {detailId && <SyncRunDetail runId={detailId} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

// ─── Activity: issues + override history + recent attempts (read-only) ──────
// Small read-only tables are duplicated here (instead of importing the
// action-bearing rows from sync-center) so this tab can never resolve,
// ignore, retry or force anything.

function StoreActivityTab({ storeId }: { storeId: string }) {
  const { data: issues, isLoading: issuesLoading } = useStoreSyncIssues(storeId)
  const { data: history, isLoading: historyLoading } = useStoreOverridesHistory(storeId)
  const { data: attempts, isLoading: attemptsLoading } = useStoreSyncAttempts(storeId)

  const issueRows = useMemo(() => ((issues ?? []) as SyncIssueResponse[]), [issues])
  const historyRows = useMemo(() => ((history ?? []) as OverrideAuditItem[]), [history])
  const attemptRows = useMemo(() => ((attempts ?? []) as { id: string; status: string; objectType: string; objectKey: string; errorCategory?: string | null; errorMessage?: string | null; createdAt: string }[]), [attempts])

  const issueColumns = useMemo<ColumnDef<SyncIssueResponse>[]>(() => [
    {
      accessorKey: 'code',
      header: 'Code',
      cell: ({ row }) => <Badge variant="outline">{row.original.code}</Badge>,
    },
    {
      accessorKey: 'message',
      header: 'Message',
      cell: ({ row }) => (
        <div className="max-w-md text-sm">
          <div>{row.original.message}</div>
          {row.original.field && <Badge variant="secondary" className="mt-1">{row.original.field}</Badge>}
        </div>
      ),
    },
    {
      accessorKey: 'occurrences',
      header: '×',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">×{row.original.occurrences}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
    },
    {
      accessorKey: 'lastSeenAt',
      header: 'Last seen',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{new Date(row.original.lastSeenAt).toLocaleString()}</span>
      ),
    },
  ], [])

  const historyColumns = useMemo<ColumnDef<OverrideAuditItem>[]>(() => [
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
    },
    {
      id: 'what',
      header: 'Field',
      cell: ({ row }) => (
        <span className="text-sm">{row.original.field ?? row.original.objectType}</span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Recorded',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'reason',
      header: 'Reason',
      cell: ({ row }) => (
        <span className="max-w-md truncate text-xs text-muted-foreground">{row.original.reason ?? '—'}</span>
      ),
    },
  ], [])

  const attemptColumns = useMemo<ColumnDef<{ id: string; status: string; objectType: string; objectKey: string; errorCategory?: string | null; createdAt: string }>[]>(
    () => [
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'FAILED' || row.original.status === 'DEAD' ? 'destructive' : 'outline'}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: 'object',
        header: 'Object',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.objectType} · {row.original.objectKey.slice(0, 48)}
          </span>
        ),
      },
      {
        accessorKey: 'errorCategory',
        header: 'Error',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.errorCategory ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{new Date(row.original.createdAt).toLocaleString()}</span>
        ),
      },
    ],
    [],
  )

  const issueTable = useReactTable({
    data: issueRows,
    columns: issueColumns,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })
  const historyTable = useReactTable({
    data: historyRows,
    columns: historyColumns,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })
  const attemptTable = useReactTable({
    data: attemptRows,
    columns: attemptColumns,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issues ({issueRows.length})</CardTitle>
          <CardDescription>Compact current-state rows for this store (read-only here — resolve in Sync Center).</CardDescription>
        </CardHeader>
        <CardContent>
          {issuesLoading ? (
            <p className="text-sm text-muted-foreground">Loading issues…</p>
          ) : issueRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues for this store.</p>
          ) : (
            <Table>
              <TableHeader>
                {issueTable.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {issueTable.getRowModel().rows.map((r) => (
                  <TableRow key={r.id}>
                    {r.getVisibleCells().map((c) => (
                      <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Override history ({historyRows.length})</CardTitle>
          <CardDescription>Every Force / Keep action for this store with actor and previous state (BR-04).</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Loading override history…</p>
          ) : historyRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No override actions recorded for this store yet.</p>
          ) : (
            <Table>
              <TableHeader>
                {historyTable.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {historyTable.getRowModel().rows.map((r) => (
                  <TableRow key={r.id}>
                    {r.getVisibleCells().map((c) => (
                      <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent attempts ({attemptRows.length})</CardTitle>
          <CardDescription>Retry-window attempts for this store (read-only here — retry in Sync Center).</CardDescription>
        </CardHeader>
        <CardContent>
          {attemptsLoading ? (
            <p className="text-sm text-muted-foreground">Loading attempts…</p>
          ) : attemptRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attempts in the 90-day window.</p>
          ) : (
            <Table>
              <TableHeader>
                {attemptTable.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {attemptTable.getRowModel().rows.map((r) => (
                  <TableRow key={r.id}>
                    {r.getVisibleCells().map((c) => (
                      <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
