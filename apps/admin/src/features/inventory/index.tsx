import { useState, useMemo, useEffect } from 'react'
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
import { Package, MoreHorizontal, ArrowLeftRight, Edit3, Filter, HelpCircle, AlertTriangle, Loader2, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { InventoryDetailDrawer } from './components/inventory-detail-drawer'
import { AdjustStockModal } from './components/adjust-stock-modal'
import { Link } from '@tanstack/react-router'

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
    availableStock: number | null
    price: number
    attributeValues: Array<{ attributeValue: { value: string } }>
  }>
  _count: { orderItems: number }
}

interface StockOverviewResponse {
  data: StockOverviewItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export function Inventory() {
  const queryClient = useQueryClient()
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustProductId, setAdjustProductId] = useState<string | undefined>()
  const [adjustVariantId, setAdjustVariantId] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [viewMode, setViewMode] = useState<'MANAGED' | 'PHYSICAL'>('PHYSICAL')
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  const toggleRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const { data: stockData, isLoading: isStockLoading, isError: isStockError } = useQuery<StockOverviewResponse>({
    queryKey: ['inventory-stock-overview', search, page],
    queryFn: () =>
      apiClient.get('/inventory/stock-overview', {
        params: { search: search || undefined, page, perPage },
      }).then((r) => r.data),
    enabled: true,
  })

  const [selectedWarehouse, setSelectedWarehouse] = useState('all_wh')
  const [selectedBin, setSelectedBin] = useState('all_bins')
  const [selectedStatus, setSelectedStatus] = useState('all_status')
  const [inventoryStatus, setInventoryStatus] = useState<'all' | 'in_stock' | 'low' | 'out_of_stock'>('all')

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const { data: binLocations } = useQuery<any[]>({
    queryKey: ['warehouse-bins', selectedWarehouse],
    queryFn: () => apiClient.get(`/warehouses/${selectedWarehouse}/bin-locations`).then(r => r.data || []),
    enabled: selectedWarehouse !== 'all_wh' && viewMode === 'PHYSICAL',
  })

  const { data: physicalData, isLoading: isPhysicalLoading, isError: isPhysicalError } = useQuery<any[]>({
    queryKey: ['inventory-physical-list'],
    queryFn: () =>
      apiClient.get('/inventory/physical').then((r) => r.data),
    enabled: viewMode === 'PHYSICAL',
  })

  const filteredPhysicalData = useMemo(() => {
    if (!physicalData) return []
    let data = physicalData

    // Warehouse Filter
    if (selectedWarehouse !== 'all_wh') {
      data = data.filter((p: any) => p.warehouseId === selectedWarehouse)
    }

    // Bin Filter
    if (selectedBin !== 'all_bins') {
      data = data.filter((p: any) => p.binLocationId === selectedBin)
    } else if (selectedBin === 'unassigned') {
      data = data.filter((p: any) => !p.binLocationId)
    }

    // Search Filter
    if (search.trim()) {
      const q = search.toLowerCase()
      data = data.filter((p: any) =>
        p.product?.name?.toLowerCase().includes(q) ||
        p.product?.sku?.toLowerCase().includes(q)
      )
    }

    // Group by product for expand/collapse support
    const productMap = new Map<string, any>()
    for (const pi of data) {
      const pid = pi.product?.id
      if (!pid) continue
      if (!productMap.has(pid)) {
        productMap.set(pid, {
          ...pi,
          _variants: [],
          _totalQty: 0,
          _totalReserved: 0,
        })
      }
      const agg = productMap.get(pid)
      agg._variants.push(pi)
      agg._totalQty += pi.quantity || 0
      agg._totalReserved += pi.reservedQuantity || 0
    }

    return Array.from(productMap.values())
  }, [physicalData, search, selectedWarehouse, selectedBin])

  const availabilityModeLabel = (mode: string) => {
    switch (mode) {
      case 'MANAGED_STOCK': return 'Managed'
      case 'INVENTORY_CONTROLLED': return 'Inventory'
      case 'ALWAYS_IN_STOCK': return 'Always In'
      case 'ALWAYS_OUT_OF_STOCK': return 'Always Out'
      default: return mode
    }
  }

  const stockLevels = useMemo(() => {
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
          warehouse: p.availabilityMode === 'INVENTORY_CONTROLLED' ? '—' : 'Main Warehouse',
          lot: '—',
          expiry: '—',
          available: p.availableStock,
          reserved: 0,
          allocated: 0,
          onHand: p.availableStock,
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

      return items
    } else {
      if (!stockData?.data) return []

      // Build physical data map by productId (aggregated totals + per-variant detail)
      const physMap = new Map<string, any>()
      const physData = filteredPhysicalData || []
      for (const pi of physData) {
        const pid = pi.product?.id
        if (!pid) continue

        let latestUpdatedAt = pi.updatedAt
        let binCode = null
        let warehouseName = 'Unknown Warehouse'

        if (pi._variants && pi._variants.length > 0) {
          for (const v of pi._variants) {
            if (v.updatedAt && (!latestUpdatedAt || v.updatedAt > latestUpdatedAt)) {
              latestUpdatedAt = v.updatedAt
            }
            if (v.binLocation?.code) {
              binCode = v.binLocation.code
            }
            if (v.warehouse?.name) {
              warehouseName = v.warehouse.name
            }
          }
        }

        physMap.set(pid, {
          _variants: pi._variants || [],
          _totalQty: pi._totalQty || 0,
          _totalReserved: pi._totalReserved || 0,
          _warehouseName: warehouseName,
          _binCode: binCode,
          _updatedAt: latestUpdatedAt,
        })
      }

      let items = stockData.data.map((p: StockOverviewItem) => {
        const phys = physMap.get(p.id)
        const variants = phys?._variants || []
        const totalQty = phys?._totalQty ?? 0
        const totalReserved = phys?._totalReserved ?? 0
        const avail = totalQty - totalReserved
        const prodImages = p.images
        const firstImg = Array.isArray(prodImages) && prodImages.length ? prodImages[0] : null
        const isVariable = p.type === 'variable'
        const hasPhysicalStock = !!phys

        // Build variant display list — merge PI records with virtual entries for variants without physical stock
        let displayVariants = variants
        if (isVariable) {
          displayVariants = [...variants]
          const piVariantIds = new Set(
            variants.filter((v: any) => v.variantId).map((v: any) => v.variantId)
          )
          const stockVariants = (p as any).variants || []
          for (const sv of stockVariants) {
            if (!piVariantIds.has(sv.id)) {
              displayVariants.push({
                id: `virtual-${sv.id}`,
                variantId: sv.id,
                variant: {
                  id: sv.id,
                  sku: sv.sku,
                  image: sv.image,
                  attributeValues: sv.attributeValues || [],
                },
                quantity: 0,
                reservedQuantity: 0,
                warehouse: null,
                binLocation: null,
                updatedAt: null,
                _virtual: true,
              })
            }
          }
        }

        return {
          id: p.id,
          productId: p.id,
          name: p.name,
          sku: p.sku || '—',
          availabilityMode: p.availabilityMode,
          warehouse: hasPhysicalStock
            ? (displayVariants.length > 1 ? `${displayVariants.length} records` : (phys._warehouseName))
            : '—',
          bin: phys?._binCode || '—',
          lot: '—',
          expiry: '—',
          available: hasPhysicalStock ? avail : 0,
          reserved: totalReserved,
          allocated: 0,
          onHand: totalQty,
          cost: p.basePrice || 0,
          lowStockQty: p.lowStockQty,
          updated: hasPhysicalStock ? (phys._updatedAt ? new Date(phys._updatedAt).toLocaleDateString() : '—') : '—',
          image: typeof firstImg === 'string' ? firstImg : null,
          status: !hasPhysicalStock ? 'optimal' : (avail < 0 ? 'negative' : (avail <= (p.lowStockQty ?? 5) ? 'low' : 'optimal')),
          raw: p,
          _physicalVariants: displayVariants,
          _hasPhysicalStock: hasPhysicalStock,
        }
      })

      // Apply physical stock filter
      if (inventoryStatus === 'in_stock') {
        items = items.filter((i: any) => i._hasPhysicalStock)
      } else if (inventoryStatus === 'out_of_stock' || inventoryStatus === 'low') {
        items = items.filter((i: any) => !i._hasPhysicalStock)
      }

      // Apply stock status filter (low/negative)
      if (selectedStatus === 'low') {
        items = items.filter((i: any) => i._hasPhysicalStock && i.available > 0 && i.available <= (i.lowStockQty ?? 5))
      } else if (selectedStatus === 'negative') {
        items = items.filter((i: any) => i.available < 0)
      }

      return items
    }
  }, [viewMode, stockData, filteredPhysicalData, inventoryStatus, selectedStatus])

  const totalPages = stockData?.meta?.totalPages || 1
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
    const item = stockLevels.find(p => p.productId === productId)
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
            <div className='flex items-center gap-1.5 bg-muted/40 p-1 border rounded-lg shrink-0'>
              <Button
                variant={viewMode === 'MANAGED' ? 'secondary' : 'ghost'}
                size='sm'
                className='h-7 text-xs px-2.5 rounded-md font-medium'
                onClick={() => { setViewMode('MANAGED'); setPage(1) }}
              >
                Managed Stock
              </Button>
              <Button
                variant={viewMode === 'PHYSICAL' ? 'secondary' : 'ghost'}
                size='sm'
                className='h-7 text-xs px-2.5 rounded-md font-medium'
                onClick={() => { setViewMode('PHYSICAL'); setPage(1) }}
              >
                Physical Inventory
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2 shrink-0">
            <Filter className="h-4 w-4" /> Filters:
          </div>
          <Input placeholder="Search name or SKU..." className="h-9 w-[200px] bg-background" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          <Select value={inventoryStatus} onValueChange={(v) => setInventoryStatus(v as any)}>
            <SelectTrigger className="h-9 w-[160px] bg-background"><SelectValue placeholder="Inventory" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              <SelectItem value="in_stock">Has Stock</SelectItem>
              <SelectItem value="low">Low / Out of Stock</SelectItem>
              <SelectItem value="out_of_stock">Out of Stock</SelectItem>
            </SelectContent>
          </Select>
          {viewMode === 'PHYSICAL' && (
            <Select value={selectedWarehouse} onValueChange={(v) => { setSelectedWarehouse(v); setSelectedBin('all_bins') }}>
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
            <Select value={selectedBin} onValueChange={setSelectedBin}>
              <SelectTrigger className="h-9 w-[160px] bg-background"><SelectValue placeholder="Bin Location" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_bins">All Bins</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {binLocations.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.code}{b.zone ? ` (${b.zone})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
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
                        <TooltipContent>On Hand - (Reserved + Allocated)</TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className='text-right'>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-end w-full gap-1">Reserved <HelpCircle className="h-3 w-3 text-muted-foreground"/></TooltipTrigger>
                        <TooltipContent>Stock committed to pending sales orders</TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className='text-right'>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-end w-full gap-1">Allocated <HelpCircle className="h-3 w-3 text-muted-foreground"/></TooltipTrigger>
                        <TooltipContent>Stock currently being picked or dispatched</TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className='text-right'>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-end w-full gap-1">On Hand <HelpCircle className="h-3 w-3 text-muted-foreground"/></TooltipTrigger>
                        <TooltipContent>Total physical stock physically present in warehouse</TooltipContent>
                      </Tooltip>
                    </TableHead>
                  </TooltipProvider>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className='w-[50px]'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={viewMode === 'PHYSICAL' ? 9 : 8} className="text-center py-12">
                      <Loader2 className="animate-spin h-6 w-6 mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : stockLevels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={viewMode === 'PHYSICAL' ? 9 : 8} className="text-center py-12 text-muted-foreground">
                      {search ? 'No products match your search.' : 'No stock levels found.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  stockLevels.map((p) => (
                    <span key={p.id} className="contents">
                      <TableRow className={`cursor-pointer hover:bg-muted/50 transition-colors ${p.status === 'negative' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`} onClick={() => handleRowClick(p)}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {(viewMode === 'MANAGED' || viewMode === 'PHYSICAL') && p.raw?.type === 'variable' ? (
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
                            <Badge variant='outline' className='text-[10px] font-mono'>{availabilityModeLabel(p.availabilityMode)}</Badge>
                          </div>
                        </TableCell>
                        {viewMode === 'PHYSICAL' && (
                          <TableCell>
                            <span className="text-sm font-mono">{p.bin || '—'}</span>
                          </TableCell>
                        )}
                        <TableCell className={`text-right font-medium ${p.available === null ? 'text-muted-foreground' : p.available < 0 ? 'text-red-600' : p.available < 10 ? 'text-amber-600' : ''}`}>
                          {p.available === null ? '∞' : p.available}
                        </TableCell>
                        <TableCell className='text-right text-orange-600'>{p.reserved}</TableCell>
                        <TableCell className='text-right text-blue-600'>{p.allocated}</TableCell>
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
                              <TableCell className="text-right text-muted-foreground text-xs">0</TableCell>
                              <TableCell className="text-right text-muted-foreground text-xs">0</TableCell>
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
                      {p.raw?.type === 'variable' && expandedRows[p.id] && viewMode === 'PHYSICAL' && p._physicalVariants &&
                        p._physicalVariants.map((pv: any) => {
                          const attrs = pv.variant?.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ') || 'Default'
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
                                      <span>SKU: {pv.variant?.sku || pv.sku || '—'}</span>
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
                              <TableCell className="text-right text-muted-foreground text-xs">0</TableCell>
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

        {stockData?.meta && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {`${(stockData.meta.page - 1) * stockData.meta.perPage + 1}-${Math.min(stockData.meta.page * stockData.meta.perPage, stockData.meta.total)} of ${stockData.meta.total}`}
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
        productName={stockLevels.find(p => p.productId === adjustProductId)?.name}
        availabilityMode={adjustAvailabilityMode}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })
          queryClient.invalidateQueries({ queryKey: ['inventory-physical-list'] })
        }}
      />
    </>
  )
}
