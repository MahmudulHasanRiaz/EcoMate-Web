import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Package, MoreHorizontal, ArrowLeftRight, Edit3, Filter, HelpCircle, AlertTriangle, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Layers } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { InventoryDetailDrawer } from './components/inventory-detail-drawer'
import { AdjustStockModal } from './components/adjust-stock-modal'
import { BulkAdjustDialog } from './components/bulk-adjust-dialog'
import { useInventoryManagement } from './hooks/use-inventory-management'
import { dedupePhysicalVariants } from './utils/dedupe-physical-variants'
import { Link, useSearch, getRouteApi } from '@tanstack/react-router'

// Route-scoped API (no import of the route file itself — that would cycle,
// the route file imports this component). Gives useNavigate() this route's
// real search type so the write-back reducer below type-checks.
const inventoryRouteApi = getRouteApi('/_authenticated/op/inventory/')

interface StockOverviewItem {
  id: string
  name: string
  slug: string
  sku: string
  type: string
  availabilityMode: string
  managedStockQuantity: number
  availableStock: number | null
  manageStock: boolean
  lowStockQty: number | null
  basePrice: number | null
  salePrice: number | null
  images: any[]
  categoryId: string | null
  category: { id: string; name: string } | null
  variants: Array<{
    id: string
    sku: string
    managedStockQuantity: number
    reservedStock?: number | null
    availableStock: number | null
    price: number
    attributeValues: Array<{ attributeValue: { value: string } }>
  }>
  _count: { orderItems: number }
  reservedStock: number
}

interface StockOverviewResponse {
  data: StockOverviewItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export function Inventory() {
  const queryClient = useQueryClient()
  // Route search params are the page's durable state: deep links land here
  // (Overview's ?filter=low_stock, the warehouse drawer's ?warehouse=<id>,
  // the orphaned physical page's redirect ?view=physical), and the Stock
  // page writes its search text / warehouse filter / view mode back so
  // navigating to a product detail and back restores them.
  const routeSearch = useSearch({ strict: false }) as {
    filter?: string
    warehouse?: string
    view?: string
    q?: string
  }
  const navigate = inventoryRouteApi.useNavigate()
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [adjustProductId, setAdjustProductId] = useState<string | undefined>()
  const [adjustVariantId, setAdjustVariantId] = useState<string | undefined>()
  const [search, setSearch] = useState(() => routeSearch?.q ?? '')
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const { data: imEnabled = true } = useInventoryManagement()
  const [viewMode, setViewMode] = useState<'MANAGED' | 'PHYSICAL'>(() =>
    routeSearch?.view === 'physical'
      ? 'PHYSICAL'
      : routeSearch?.view === 'managed'
        ? 'MANAGED'
        : imEnabled
          ? 'PHYSICAL'
          : 'MANAGED',
  )
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!imEnabled && viewMode === 'PHYSICAL') {
      setViewMode('MANAGED')
      setPage(1)
    }
  }, [imEnabled, viewMode])

  const toggleRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Server-side sort for the On Hand column — the only quantity column the
  // stock-overview endpoint can order by (sortBy 'stock' maps to
  // managedStockQuantity). Available/Reserved are computed post-query
  // server-side, so they have no sort field; their headers stay tooltip-only.
  const [stockSort, setStockSort] = useState<'asc' | 'desc' | null>(null)
  const toggleStockSort = () => {
    setStockSort((prev) => (prev === null ? 'desc' : prev === 'desc' ? 'asc' : null))
    setPage(1)
  }

  const { data: stockData, isLoading: isStockLoading, isError: isStockError, refetch: refetchStock } = useQuery<StockOverviewResponse>({
    queryKey: ['inventory-stock-overview', search, page, stockSort],
    queryFn: () =>
      apiClient.get('/inventory/stock-overview', {
        params: {
          search: search || undefined,
          page,
          perPage,
          sortBy: stockSort ? 'stock' : undefined,
          sortOrder: stockSort ?? undefined,
        },
      }).then((r) => r.data),
    enabled: true,
  })

  const [selectedWarehouse, setSelectedWarehouse] = useState(() => routeSearch?.warehouse ?? 'all_wh')
  const [selectedBin, setSelectedBin] = useState('all_bins')
  const [selectedStatus, setSelectedStatus] = useState('all_status')
  const [inventoryStatus, setInventoryStatus] = useState<'all' | 'in_stock' | 'low' | 'out_of_stock'>('all')

  // Deep links into this page: the Overview "View all low stock" link
  // (?filter=low_stock), the warehouse drawer's "View Filtered Stock" link
  // (?warehouse=<id>) and the physical-page redirect (?view=physical).
  // Without reading them those links landed on an unfiltered list.
  const routeFilter = routeSearch?.filter
  const routeWarehouse = routeSearch?.warehouse
  const routeView = routeSearch?.view
  useEffect(() => {
    if (routeFilter === 'low_stock') {
      setInventoryStatus('low')
    }
    if (routeWarehouse) {
      setSelectedWarehouse(routeWarehouse)
      setSelectedBin('all_bins')
      setViewMode('PHYSICAL')
      setPage(1)
    } else if (routeView === 'physical') {
      setViewMode('PHYSICAL')
    }
  }, [routeFilter, routeWarehouse, routeView])

  // Write the durable filter state back into the URL (replace, no history
  // spam) so leaving for a product detail and coming back restores it. The
  // ref guard keeps the effect from re-navigating when nothing changed
  // (navigate's identity is not guaranteed stable across renders).
  const lastWrittenSearchRef = useRef('')
  useEffect(() => {
    const signature = JSON.stringify({ q: search, warehouse: selectedWarehouse, view: viewMode })
    if (lastWrittenSearchRef.current === signature) return
    lastWrittenSearchRef.current = signature
    navigate({
      // No explicit `prev` annotation: TanStack types it as this route's
      // search object; annotating it Record<string, unknown> breaks the
      // ParamsReducerFn assignability (the spread leaks an index signature).
      search: (prev) => ({
        ...prev,
        q: search || undefined,
        warehouse: selectedWarehouse !== 'all_wh' ? selectedWarehouse : undefined,
        view: viewMode === 'PHYSICAL' ? 'physical' : 'managed',
      }),
      replace: true,
    })
  }, [navigate, search, selectedWarehouse, viewMode])

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const { data: binLocations } = useQuery<any[]>({
    queryKey: ['warehouse-bins', selectedWarehouse],
    queryFn: () => apiClient.get(`/warehouses/${selectedWarehouse}/bin-locations`).then(r => r.data || []),
    enabled: selectedWarehouse !== 'all_wh' && viewMode === 'PHYSICAL',
  })

  // The physical endpoint filters SERVER-side by warehouseId and
  // binLocationId ('' = unassigned/NULL bin) and returns EVERY matching
  // row — there is no pagination and no search param on it. Warehouse/bin
  // therefore go out as real query params instead of the old approach:
  // fetch one page of the product catalogue and client-filter the physical
  // rows that happened to overlap it (which silently dropped every product
  // outside that page).
  const physicalParams: Record<string, string> = {}
  if (selectedWarehouse !== 'all_wh') physicalParams.warehouseId = selectedWarehouse
  if (selectedBin === 'unassigned') physicalParams.binLocationId = ''
  else if (selectedBin !== 'all_bins') physicalParams.binLocationId = selectedBin

  const { data: physicalData, isLoading: isPhysicalLoading, isError: isPhysicalError, refetch: refetchPhysical } = useQuery<any[]>({
    queryKey: ['inventory-physical-list', physicalParams],
    queryFn: () =>
      apiClient.get('/inventory/physical', { params: physicalParams }).then((r) => r.data),
    enabled: viewMode === 'PHYSICAL',
  })

  // Group the (complete, server-filtered) physical rows by product. Search
  // and the status filters run over this complete set in the stockLevels
  // memo — the endpoint has no search param, but because it returns all
  // matching rows, filtering the grouped set client-side is over the FULL
  // result, never over one catalogue page.
  const physicalGroups = useMemo(() => {
    if (!physicalData) return []
    const productMap = new Map<string, { product: any; records: any[] }>()
    for (const pi of physicalData) {
      const pid = pi.product?.id ?? pi.productId
      if (!pid) continue
      if (!productMap.has(pid)) {
        productMap.set(pid, { product: pi.product ?? { id: pid }, records: [] })
      }
      productMap.get(pid)!.records.push(pi)
    }
    let groups = Array.from(productMap.values())
    if (search.trim()) {
      const q = search.toLowerCase()
      groups = groups.filter((g) =>
        g.product?.name?.toLowerCase().includes(q) ||
        g.product?.sku?.toLowerCase().includes(q),
      )
    }
    return groups
  }, [physicalData, search])

  const availabilityModeLabel = (mode: string) => {
    switch (mode) {
      case 'MANAGED_STOCK': return 'Managed'
      case 'INVENTORY_CONTROLLED': return 'Inventory'
      case 'ALWAYS_IN_STOCK': return 'Always In'
      case 'ALWAYS_OUT_OF_STOCK': return 'Always Out'
      default: return mode
    }
  }

  const stockRows = useMemo<any[]>(() => {
    if (viewMode === 'MANAGED') {
      if (!stockData?.data) return []
      let items = stockData.data.map((p: StockOverviewItem) => {
        const physicalStock = (p as any)._physicalStock ?? 0
        return {
          id: p.id,
          productId: p.id,
          name: p.name,
          sku: p.sku,
          availabilityMode: p.availabilityMode,
          // Managed stock is virtual — the payload carries no warehouse.
          // Show the warehouse name when the payload provides one, else
          // '—'. (This used to fabricate a 'Main Warehouse' location.)
          warehouse: (p as any).warehouseName ?? (p as any).warehouse?.name ?? '—',
          lot: '—',
          expiry: '—',
          available: p.availableStock,
          reserved: p.availabilityMode === 'MANAGED_STOCK' ? (p.reservedStock ?? 0) : 0,
          onHand: p.availabilityMode === 'MANAGED_STOCK' ? (p.managedStockQuantity ?? 0) : p.availableStock,
          cost: p.basePrice || 0,
          lowStockQty: p.lowStockQty,
          updated: '—',
          image: Array.isArray(p.images) && p.images.length ? p.images[0] : null,
          status: p.availableStock != null && p.availableStock < 0 ? 'negative' : (p.availableStock != null && p.lowStockQty != null && p.availableStock <= p.lowStockQty ? 'low' : 'optimal'),
          raw: p,
          _hasPhysicalStock: physicalStock > 0,
        }
      })

      // Apply inventory status filter
      if (inventoryStatus === 'in_stock') {
        items = items.filter((i) => i._hasPhysicalStock || (i.available != null && i.available > 0))
      } else if (inventoryStatus === 'low') {
        items = items.filter((i) => i.status === 'low' || i.status === 'negative')
      } else if (inventoryStatus === 'out_of_stock') {
        items = items.filter((i) => i.available != null && i.available <= 0)
      }

      // Apply stock status filter (low/negative). The row `status` already
      // encodes the threshold rule (negative when available < 0; low when
      // available <= lowStockQty, using the product's own threshold).
      if (selectedStatus === 'low') {
        items = items.filter((i) => i.status === 'low')
      } else if (selectedStatus === 'negative') {
        items = items.filter((i) => i.available != null && i.available < 0)
      }

      return items
    } else {
      // PHYSICAL view: one row per product that HAS physical records,
      // built entirely from the physical endpoint's own (complete,
      // server-filtered) rows — the product catalogue is not involved, so
      // products outside any single catalogue page are no longer dropped.
      let items = physicalGroups.map((g) => {
        const records = g.records as any[]
        const prod = g.product ?? {}
        const totalQty = records.reduce((s, r) => s + (r.quantity || 0), 0)
        const totalReserved = records.reduce((s, r) => s + (r.reservedQuantity || 0), 0)
        const avail = totalQty - totalReserved
        const hasVariants = records.some((r) => r.variantId)
        // One expanded row per variant (aggregated across warehouses/bins)
        // for variable products; per location record for simple ones.
        const displayVariants = hasVariants ? dedupePhysicalVariants(records) : records
        const warehouseNames = [...new Set(records.map((r) => r.warehouse?.name).filter(Boolean))] as string[]
        const binCodes = [...new Set(records.map((r) => r.binLocation?.code).filter(Boolean))] as string[]
        const latestUpdatedAt = records.reduce<string | null>(
          (max, r) => (r.updatedAt && (!max || r.updatedAt > max) ? r.updatedAt : max),
          null,
        )
        const firstImg = Array.isArray(prod.images) && prod.images.length ? prod.images[0] : null
        const lowStockQty = prod.lowStockQty ?? null
        const status = avail < 0 ? 'negative' : avail <= (lowStockQty ?? 5) ? 'low' : 'optimal'
        return {
          id: prod.id,
          productId: prod.id,
          name: prod.name,
          sku: prod.sku || '—',
          availabilityMode: undefined as string | undefined,
          warehouse: hasVariants && displayVariants.length > 1
            ? `${displayVariants.length} variants`
            : warehouseNames.length > 1
              ? `${warehouseNames.length} warehouses`
              : (warehouseNames[0] ?? '—'),
          bin: binCodes.length ? binCodes.join(' · ') : '—',
          lot: '—',
          expiry: '—',
          available: avail,
          reserved: totalReserved,
          onHand: totalQty,
          cost: 0,
          lowStockQty,
          updated: latestUpdatedAt ? new Date(latestUpdatedAt).toLocaleDateString() : '—',
          image: typeof firstImg === 'string' ? firstImg : null,
          status,
          // The drawer accepts this explicit shape (onHand/available/
          // reserved/status) — the physical payload has no catalogue row.
          raw: {
            id: prod.id,
            name: prod.name,
            sku: prod.sku,
            images: prod.images,
            lowStockQty,
            type: hasVariants ? 'variable' : 'simple',
            onHand: totalQty,
            available: avail,
            reserved: totalReserved,
            status,
          },
          _physicalVariants: displayVariants,
          _expandable: hasVariants || records.length > 1,
          _hasPhysicalStock: true,
        }
      })

      // Status filters run over the complete grouped set (see above).
      if (inventoryStatus === 'in_stock') {
        items = items.filter((i: any) => i.available > 0)
      } else if (inventoryStatus === 'out_of_stock') {
        items = items.filter((i: any) => i.available <= 0)
      } else if (inventoryStatus === 'low') {
        items = items.filter((i: any) => i.status === 'low' || i.status === 'negative')
      }

      // Apply stock status filter (low/negative)
      if (selectedStatus === 'low') {
        items = items.filter((i: any) => i.available > 0 && i.available <= (i.lowStockQty ?? 5))
      } else if (selectedStatus === 'negative') {
        items = items.filter((i: any) => i.available < 0)
      }

      return items
    }
  }, [viewMode, stockData, physicalGroups, inventoryStatus, selectedStatus])

  // MANAGED pages server-side via stock-overview's meta; PHYSICAL pages
  // client-side over the complete grouped set.
  const stockLevels = useMemo(() => {
    if (viewMode !== 'PHYSICAL') return stockRows
    return stockRows.slice((page - 1) * perPage, page * perPage)
  }, [viewMode, stockRows, page, perPage])

  const totalPages = viewMode === 'PHYSICAL'
    ? Math.max(1, Math.ceil(stockRows.length / perPage))
    : stockData?.meta?.totalPages || 1
  const isLoading = viewMode === 'MANAGED' ? isStockLoading : isPhysicalLoading
  const isError = viewMode === 'MANAGED' ? isStockError : isPhysicalError

  useEffect(() => {
    if (isError) toast.error('Failed to load stock overview')
  }, [isError])

  const handleRowClick = (item: any) => {
    setSelectedProduct(item.raw)
    setDetailOpen(true)
  }

  const [adjustAvailabilityMode, setAdjustAvailabilityMode] = useState<string | undefined>()
  const [adjustVariantName, setAdjustVariantName] = useState<string | undefined>()
  const handleQuickAdjust = (productId?: string, variantId?: string, variantName?: string) => {
    if (!productId) return
    const item = stockRows.find(p => p.productId === productId)
    setAdjustProductId(productId)
    setAdjustVariantId(variantId)
    setAdjustVariantName(variantName)
    setAdjustAvailabilityMode(item?.availabilityMode)
    setAdjustOpen(true)
  }

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Stock</h2>
            <p className='text-muted-foreground text-sm'>
              {viewMode === 'PHYSICAL'
                ? 'Physical inventory — actual warehouse stock with bin locations.'
                : 'Managed stock — virtual sales availability count.'}
            </p>
          </div>
          <div className='flex items-center gap-3'>
            {viewMode === 'MANAGED' && (
              <Button variant='outline' size='sm' className='h-8 text-xs' onClick={() => setBulkOpen(true)}>
                <Layers className='h-4 w-4 mr-1' /> Bulk Adjust
              </Button>
            )}
            <div className='flex items-center gap-1.5 bg-muted/40 p-1 border rounded-lg shrink-0'>
              <Button
                variant={viewMode === 'MANAGED' ? 'secondary' : 'ghost'}
                size='sm'
                className='h-7 text-xs px-2.5 rounded-md font-medium'
                onClick={() => { setViewMode('MANAGED'); setPage(1) }}
              >
                Managed Stock
              </Button>
              {imEnabled && (
                <Button
                  variant={viewMode === 'PHYSICAL' ? 'secondary' : 'ghost'}
                  size='sm'
                  className='h-7 text-xs px-2.5 rounded-md font-medium'
                  onClick={() => { setViewMode('PHYSICAL'); setPage(1) }}
                >
                  Physical Inventory
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2 shrink-0">
            <Filter className="h-4 w-4" /> Filters:
          </div>
          <Input placeholder="Search name or SKU..." className="h-9 w-[200px] bg-background" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          <Select value={inventoryStatus} onValueChange={(v) => { setInventoryStatus(v as any); setPage(1) }}>
            <SelectTrigger className="h-9 w-[160px] bg-background"><SelectValue placeholder="Inventory" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              <SelectItem value="in_stock">Has Stock</SelectItem>
              <SelectItem value="low">Low / Out of Stock</SelectItem>
              <SelectItem value="out_of_stock">Out of Stock</SelectItem>
            </SelectContent>
          </Select>
          {viewMode === 'PHYSICAL' && (
            <Select value={selectedWarehouse} onValueChange={(v) => { setSelectedWarehouse(v); setSelectedBin('all_bins'); setPage(1) }}>
              <SelectTrigger className="h-9 w-[180px] bg-background"><SelectValue placeholder="Warehouse" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_wh">All Warehouses</SelectItem>
                {(warehouses || []).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {viewMode === 'PHYSICAL' && selectedWarehouse !== 'all_wh' && binLocations && binLocations.length > 0 && (
            <Select value={selectedBin} onValueChange={(v) => { setSelectedBin(v); setPage(1) }}>
              <SelectTrigger className="h-9 w-[160px] bg-background"><SelectValue placeholder="Bin Location" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_bins">All Bins</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {binLocations.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.code}{b.zone?.name ? ` (${b.zone.name})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={selectedStatus} onValueChange={(v) => { setSelectedStatus(v); setPage(1) }}>
            <SelectTrigger className="h-9 w-[150px] bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all_status">All Statuses</SelectItem>
              <SelectItem value="low">Low Stock</SelectItem>
              <SelectItem value="negative">Negative Stock</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Location</TableHead>
                  {viewMode === 'PHYSICAL' && <TableHead>Bin</TableHead>}
                  <TooltipProvider>
                    <TableHead className='text-right'>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-end w-full gap-1">Available <HelpCircle className="h-3 w-3 text-muted-foreground"/></TooltipTrigger>
                        <TooltipContent>On Hand - Reserved</TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className='text-right'>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-end w-full gap-1">Reserved <HelpCircle className="h-3 w-3 text-muted-foreground"/></TooltipTrigger>
                        <TooltipContent>Stock committed to pending sales orders</TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className='text-right'>
                      <div className="flex items-center justify-end w-full gap-1">
                        <button
                          type="button"
                          onClick={toggleStockSort}
                          className="flex items-center gap-0.5 hover:text-foreground"
                          title="Sort by on-hand quantity"
                        >
                          On Hand
                          {stockSort === 'desc' && <ChevronDown className="h-3 w-3" />}
                          {stockSort === 'asc' && <ChevronUp className="h-3 w-3" />}
                        </button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>Total physical stock physically present in warehouse</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableHead>
                  </TooltipProvider>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className='w-[50px]'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={viewMode === 'PHYSICAL' ? 8 : 7} className="text-center py-12">
                      <Loader2 className="animate-spin h-6 w-6 mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={viewMode === 'PHYSICAL' ? 8 : 7} className="text-center py-12">
                      <p className="text-sm text-destructive mb-2">Failed to load stock data.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { refetchStock(); if (viewMode === 'PHYSICAL') refetchPhysical() }}
                      >
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : stockLevels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={viewMode === 'PHYSICAL' ? 8 : 7} className="text-center py-12 text-muted-foreground">
                      {search ? 'No products match your search.' : 'No stock levels found.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  stockLevels.map((p) => (
                    <span key={p.id} className="contents">
                      <TableRow className={`cursor-pointer hover:bg-muted/50 transition-colors ${p.status === 'negative' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`} onClick={() => handleRowClick(p)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {p.raw?.type === 'variable' || (p as any)._expandable ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-muted"
                                onClick={(e) => toggleRow(p.id, e)}
                              >
                                {expandedRows[p.id] ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            ) : (
                              <div className="w-7 shrink-0" />
                            )}
                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                              {p.image ? (
                                <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                              ) : (
                                <Package className="h-5 w-5 text-muted-foreground/50" />
                              )}
                            </div>
                            <div>
                              <div className="font-medium flex items-center gap-2 text-sm sm:text-base">
                                {p.status === 'negative' && <AlertTriangle className="h-4 w-4 text-red-500" />}
                                {p.status === 'low' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                                {p.name}
                              </div>
                              <div className="text-xs text-muted-foreground">{p.sku}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{p.warehouse}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex gap-2">
                            {p.lot !== '—' && <span>Lot: {p.lot}</span>}
                            {p.expiry !== '—' && <span className="text-amber-600">Exp: {p.expiry}</span>}
                            {p.availabilityMode && (
                              <Badge variant='outline' className='text-[10px] font-mono'>{availabilityModeLabel(p.availabilityMode)}</Badge>
                            )}
                          </div>
                        </TableCell>
                        {viewMode === 'PHYSICAL' && (
                          <TableCell>
                            <span className="text-sm font-mono">{(p as any).bin || '—'}</span>
                          </TableCell>
                        )}
                        <TableCell className={`text-right font-medium ${p.available === null ? 'text-muted-foreground' : p.available < 0 ? 'text-red-600' : p.available < 10 ? 'text-amber-600' : ''}`}>
                          {p.available === null ? '∞' : p.available}
                        </TableCell>
                        <TableCell className='text-right text-orange-600'>{p.reserved}</TableCell>
                        <TableCell className='text-right font-bold'>
                          {p.onHand === null ? '∞' : p.onHand}
                        </TableCell>
                        <TableCell className='text-sm text-muted-foreground'>{p.updated}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {p.raw?.type !== 'variable' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleQuickAdjust(p.productId)}
                              >
                                <Edit3 className="h-3 w-3 mr-1" /> Adjust
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => handleRowClick(p)}>Quick Drawer</DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                  <Link to="/op/inventory/detail" search={{ productId: p.productId }}>
                                    Full Detail Page
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild><Link to="/op/inventory/transfers"><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Link></DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                      {p.raw?.type === 'variable' && expandedRows[p.id] && viewMode === 'MANAGED' && 
                        (p.raw.variants || []).map((v: any) => {
                          const attrs = v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || 'Default'
                          const variantImg = v.image || p.image
                          const avail = v.availableStock ?? v.managedStockQuantity
                          return (
                            <TableRow key={v.id} className="bg-muted/5 hover:bg-muted/10 transition-colors border-l-2 border-l-primary/40">
                              <TableCell className="pl-10">
                                <div className="flex items-center gap-3">
                                  <div className="h-8 w-8 shrink-0 rounded border bg-muted flex items-center justify-center overflow-hidden">
                                    {variantImg ? (
                                      <img src={variantImg} alt={v.sku} className="h-full w-full object-cover" />
                                    ) : (
                                      <Package className="h-4 w-4 text-muted-foreground/30" />
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-semibold text-sm">{attrs}</div>
                                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                      <span>SKU: {v.sku}</span>
                                      <span className="text-muted-foreground/30">•</span>
                                      <span className="text-foreground/80 font-medium">৳{Number(v.price || 0).toFixed(2)}</span>
                                      <span className="text-muted-foreground/30">•</span>
                                      <span>Min: {p.lowStockQty ?? 5}</span>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs font-medium">
                                {p.warehouse}
                              </TableCell>
                              <TableCell className={`text-right font-semibold text-sm ${avail === null ? 'text-muted-foreground' : avail < 0 ? 'text-red-600' : avail < 10 ? 'text-amber-600' : 'text-green-600'}`}>
                                {avail === null ? '∞' : avail}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground text-xs">{v.reservedStock ?? 0}</TableCell>
                              <TableCell className="text-right font-medium text-sm">
                                {v.managedStockQuantity}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">—</TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => handleQuickAdjust(p.productId, v.id, attrs)}
                                  >
                                    <Edit3 className="h-3 w-3 mr-1" /> Adjust
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" className="h-8 w-8 p-0">
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuLabel>Variant Actions</DropdownMenuLabel>
                                      <DropdownMenuItem onClick={() => handleRowClick({ raw: { ...p.raw, sku: v.sku, name: `${p.name} (${attrs})`, availableStock: avail } })}>Quick Drawer</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      }
                      {expandedRows[p.id] && viewMode === 'PHYSICAL' && (p as any)._physicalVariants &&
                        (p as any)._physicalVariants.map((pv: any) => {
                          // Variant rows are labelled by their attributes;
                          // simple-product rows are per-location records, so
                          // they are labelled by their bin instead.
                          const attrs = pv.variant?.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ')
                            || (pv.variantId ? 'Default' : pv.binLocation?.code ? `Bin ${pv.binLocation.code}` : 'No bin assigned')
                          const variantImg = pv.variant?.image || p.image
                          const pvAvail = (pv.quantity || 0) - (pv.reservedQuantity || 0)
                          return (
                            <TableRow key={pv.id} className="bg-muted/5 hover:bg-muted/10 transition-colors border-l-2 border-l-primary/40">
                              <TableCell className="pl-10">
                                <div className="flex items-center gap-3">
                                  <div className="h-8 w-8 shrink-0 rounded border bg-muted flex items-center justify-center overflow-hidden">
                                    {variantImg ? (
                                      <img src={variantImg} alt={pv.variant?.sku || pv.sku} className="h-full w-full object-cover" />
                                    ) : (
                                      <Package className="h-4 w-4 text-muted-foreground/30" />
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-semibold text-sm">{attrs}</div>
                                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                      <span>SKU: {pv.variant?.sku || p.sku || '—'}</span>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs font-medium">
                                {pv.warehouse?.name || '—'}
                              </TableCell>
                              <TableCell>
                                <span className="text-xs font-mono">{pv.binLocation?.code || '—'}</span>
                              </TableCell>
                              <TableCell className={`text-right font-semibold text-sm ${pvAvail < 0 ? 'text-red-600' : pvAvail < 10 ? 'text-amber-600' : 'text-green-600'}`}>
                                {pvAvail}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground text-xs">{pv.reservedQuantity || 0}</TableCell>
                              <TableCell className="text-right font-medium text-sm">
                                {pv.quantity}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {pv.updatedAt ? new Date(pv.updatedAt).toLocaleDateString() : '—'}
                              </TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => handleQuickAdjust(p.productId, pv.variantId, attrs)}
                                  >
                                    <Edit3 className="h-3 w-3 mr-1" /> Adjust
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      }
                    </span>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {viewMode === 'PHYSICAL'
                ? `${(page - 1) * perPage + 1}-${Math.min(page * perPage, stockRows.length)} of ${stockRows.length}`
                : stockData?.meta
                  ? `${(stockData.meta.page - 1) * stockData.meta.perPage + 1}-${Math.min(stockData.meta.page * stockData.meta.perPage, stockData.meta.total)} of ${stockData.meta.total}`
                  : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Main>

      <InventoryDetailDrawer 
        open={detailOpen} 
        onOpenChange={setDetailOpen} 
        productDetails={selectedProduct} 
        onAdjust={() => handleQuickAdjust(selectedProduct?.id)}
      />

      <AdjustStockModal 
        open={adjustOpen} 
        onOpenChange={setAdjustOpen} 
        productId={adjustProductId} 
        variantId={adjustVariantId}
        variantName={adjustVariantName}
        productName={stockRows.find(p => p.productId === adjustProductId)?.name}
        availabilityMode={adjustAvailabilityMode}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })
          queryClient.invalidateQueries({ queryKey: ['inventory-physical-list'] })
        }}
      />

      <BulkAdjustDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })
          queryClient.invalidateQueries({ queryKey: ['inventory', 'low-stock'] })
        }}
      />
    </>
  )
}
