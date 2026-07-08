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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Package, MoreHorizontal, ArrowLeftRight, Edit3, Filter, HelpCircle, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { InventoryDetailDrawer } from './components/inventory-detail-drawer'
import { QuickAdjustmentModal } from './components/quick-adjustment-modal'
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
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)

  const { data: stockData, isLoading, isError } = useQuery<StockOverviewResponse>({
    queryKey: ['inventory-stock-overview', search, page],
    queryFn: () =>
      apiClient.get('/inventory/stock-overview', {
        params: { search: search || undefined, page, perPage },
      }).then((r) => r.data),
  })

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
    if (!stockData?.data) return []
    return stockData.data.map((p: StockOverviewItem) => ({
      id: p.id,
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
      status: p.availableStock != null && p.availableStock < 0 ? 'negative' : (p.availableStock != null && p.lowStockQty != null && p.availableStock <= p.lowStockQty ? 'low' : 'optimal'),
    }))
  }, [stockData])

  const totalPages = stockData?.meta?.totalPages || 1

  useEffect(() => {
    if (isError) toast.error('Failed to load stock overview')
  }, [isError])

  const handleRowClick = (product: any) => {
    setSelectedProduct(product)
    setDetailOpen(true)
  }

  const [adjustAvailabilityMode, setAdjustAvailabilityMode] = useState<string | undefined>()
  const handleQuickAdjust = (productId?: string) => {
    setAdjustProductId(productId)
    setAdjustAvailabilityMode(stockLevels.find(p => p.id === productId)?.availabilityMode)
    setAdjustOpen(true)
  }

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Stock Levels</h2>
            <p className='text-muted-foreground text-sm'>Primary operational view of all physical stock.</p>
          </div>
          <Button onClick={() => handleQuickAdjust()}><Edit3 className='h-4 w-4 mr-1' /> Quick Adjust</Button>
        </div>

        <div className="flex flex-wrap items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2 shrink-0">
            <Filter className="h-4 w-4" /> Filters:
          </div>
          <Input placeholder="Search name or SKU..." className="h-9 w-[200px] bg-background" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          <Select defaultValue="all_wh">
            <SelectTrigger className="h-9 w-[180px] bg-background"><SelectValue placeholder="Warehouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all_wh">All Warehouses</SelectItem>
              <SelectItem value="main">Main Warehouse</SelectItem>
              <SelectItem value="retail">Retail Store</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all_status">
            <SelectTrigger className="h-9 w-[150px] bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all_status">All Statuses</SelectItem>
              <SelectItem value="low">Low Stock</SelectItem>
              <SelectItem value="negative">Negative Stock</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" className="h-9 w-[150px] bg-background" title="Expiry before" />
        </div>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Location</TableHead>
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
                    <TableCell colSpan={8} className="text-center py-12">
                      <Loader2 className="animate-spin h-6 w-6 mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : stockLevels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      {search ? 'No products match your search.' : 'No stock levels found.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  stockLevels.map((p) => (
                    <TableRow key={p.id} className={`cursor-pointer hover:bg-muted/50 transition-colors ${p.status === 'negative' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`} onClick={() => handleRowClick(p)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                            <Package className="h-5 w-5 text-muted-foreground/50" />
                          </div>
                          <div>
                            <div className="font-medium flex items-center gap-2">
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => handleRowClick(p)}>Quick Drawer</DropdownMenuItem>
                            <DropdownMenuItem asChild><Link to="/op/inventory/detail">Full Detail Page</Link></DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleQuickAdjust(p.id)}><Edit3 className="mr-2 h-4 w-4" /> Quick Adjust</DropdownMenuItem>
                            <DropdownMenuItem asChild><Link to="/op/inventory/transfers"><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Link></DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {stockData?.meta ? `${(stockData.meta.page - 1) * stockData.meta.perPage + 1}-${Math.min(stockData.meta.page * stockData.meta.perPage, stockData.meta.total)} of ${stockData.meta.total}` : ''}
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
      </Main>

      <InventoryDetailDrawer 
        open={detailOpen} 
        onOpenChange={setDetailOpen} 
        productDetails={selectedProduct} 
        onAdjust={() => handleQuickAdjust(selectedProduct?.id)}
      />

      <QuickAdjustmentModal 
        open={adjustOpen} 
        onOpenChange={setAdjustOpen} 
        productId={adjustProductId} 
        productName={stockLevels.find(p => p.id === adjustProductId)?.name}
        availabilityMode={adjustAvailabilityMode}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['inventory-stock-overview'] })}
      />
    </>
  )
}
