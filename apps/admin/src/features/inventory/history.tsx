import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { useInventoryManagement } from './hooks/use-inventory-management'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Loader2, Calendar, User, Search, RefreshCw, FileText, Check, ChevronsUpDown, X, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserBadge } from '@/components/user-badge'

interface Product {
  id: string
  name: string
  sku: string
}

interface LogEntry {
  id: string
  productId: string
  variantId?: string | null
  variantName?: string | null
  productName: string
  sku: string
  warehouseName?: string
  quantity: number
  direction: 'IN' | 'OUT'
  type: string
  stockBefore: number
  stockAfter: number
  reason?: string
  note?: string
  performedBy: string
  performedAt: string
  unitCost?: number | null
  image?: string | null
}

interface Meta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

interface ApiResponse {
  data: LogEntry[]
  meta: Meta
}

export function MovementHistory() {
  const { data: imEnabled = true } = useInventoryManagement()
  const [ledgerMode, setLedgerMode] = useState<'PHYSICAL' | 'MANAGED'>('PHYSICAL')

  useEffect(() => {
    if (!imEnabled) {
      setLedgerMode('MANAGED')
    }
  }, [imEnabled])
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('adjustment')
  const [warehouseFilter, setWarehouseFilter] = useState('all')

  // Product Search State
  const [productSearch, setProductSearch] = useState('')
  const [productSearchOpen, setProductSearchOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

  // Fetch product search results
  const { data: productResults, isFetching: searchingProducts } = useQuery<Product[]>({
    queryKey: ['product-search-history', productSearch],
    queryFn: () =>
      apiClient
        .get<{ data: Product[] }>('/products', { params: { search: productSearch, perPage: 8 } })
        .then((r) => r.data?.data || r.data || []),
    enabled: productSearch.length > 0,
  })

  // Fetch warehouses
  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then((r) => r.data?.data || r.data || []),
  })

  // Fetch logs based on mode
  const { data: logsRes, isLoading, isError, error, refetch } = useQuery<ApiResponse>({
    queryKey: ['inventory-history-logs', ledgerMode, page, typeFilter, warehouseFilter, selectedProduct?.id],
    queryFn: () => {
      const endpoint = ledgerMode === 'PHYSICAL' ? '/inventory/logs' : '/inventory/ledger'
      const params: Record<string, any> = {
        page,
        perPage: 15,
        productId: selectedProduct?.id || undefined,
      }

      if (typeFilter !== 'all') {
        params.type = typeFilter
      }

      if (ledgerMode === 'PHYSICAL' && warehouseFilter !== 'all') {
        params.warehouseId = warehouseFilter
      }

      return apiClient.get<ApiResponse>(endpoint, { params }).then((r) => r.data)
    },
  })

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [ledgerMode, typeFilter, warehouseFilter, selectedProduct])

  const logs = logsRes?.data ?? []
  const meta = logsRes?.meta

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className="me-auto" />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Movement History</h1>
            <p className="text-muted-foreground text-sm">
              Audit trail of physical warehouse stock and product catalog managed changes.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-muted/40 p-1 border rounded-lg shrink-0 w-fit">
            {imEnabled && (
              <Button
                variant={ledgerMode === 'PHYSICAL' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs px-3 rounded-md font-medium"
                onClick={() => {
                  setLedgerMode('PHYSICAL')
                  setTypeFilter('adjustment')
                }}
              >
                Physical Stock Ledger
              </Button>
            )}
            <Button
              variant={ledgerMode === 'MANAGED' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs px-3 rounded-md font-medium"
              onClick={() => {
                setLedgerMode('MANAGED')
                setTypeFilter('all')
              }}
            >
              Catalog Managed Ledger
            </Button>
          </div>
        </div>

        {/* Filters Area */}
        <div className="flex flex-wrap items-center gap-4 bg-muted/30 p-4 rounded-lg border">
          {/* Product Filter */}
          <div className="flex flex-col gap-1.5 w-full sm:w-[250px]">
            <span className="text-xs font-medium text-muted-foreground">Filter by Product</span>
            <div className="flex items-center gap-2">
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={productSearchOpen}
                    className="w-full justify-between h-9 bg-background text-sm font-normal"
                  >
                    <span className="truncate">
                      {selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : 'Select product...'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Type name or SKU..."
                      value={productSearch}
                      onValueChange={setProductSearch}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {searchingProducts ? 'Searching...' : 'No products found.'}
                      </CommandEmpty>
                      <CommandGroup>
                        {(productResults || []).map((p) => (
                          <CommandItem
                            key={p.id}
                            value={p.id}
                            onSelect={() => {
                              setSelectedProduct(p)
                              setProductSearchOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedProduct?.id === p.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <div>
                              <div className="font-medium">{p.name}</div>
                              <div className="text-xs text-muted-foreground">{p.sku}</div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedProduct && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setSelectedProduct(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Warehouse Filter (Physical Only) */}
          {ledgerMode === 'PHYSICAL' && (
            <div className="flex flex-col gap-1.5 w-[180px]">
              <span className="text-xs font-medium text-muted-foreground">Warehouse</span>
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue placeholder="All Warehouses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Warehouses</SelectItem>
                  {(warehouses || []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Type Filter */}
          <div className="flex flex-col gap-1.5 w-[180px]">
            <span className="text-xs font-medium text-muted-foreground">Movement Type</span>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 bg-background">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {ledgerMode === 'PHYSICAL' ? (
                  <>
                    <SelectItem value="adjustment">Adjustments</SelectItem>
                    <SelectItem value="transfer">Transfers</SelectItem>
                    <SelectItem value="purchase_receive">Purchase Receipts</SelectItem>
                    <SelectItem value="order_fulfilled">Sales Dispatch</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="INITIAL">Initial Balance</SelectItem>
                    <SelectItem value="MANUAL_ADD">Manual Add</SelectItem>
                    <SelectItem value="MANUAL_REMOVE">Manual Remove</SelectItem>
                    <SelectItem value="ORDER_DEDUCTION">Order Deduction</SelectItem>
                    <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                    <SelectItem value="CANCEL_RELEASE">Cancel Release</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            className="h-9 w-9 sm:mt-5 bg-background text-muted-foreground hover:text-foreground shrink-0"
            title="Refresh history"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Ledger Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Product</TableHead>
                  {ledgerMode === 'PHYSICAL' && <TableHead>Warehouse</TableHead>}
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right font-semibold">Qty</TableHead>
                  {ledgerMode === 'PHYSICAL' && <TableHead className="text-right">Unit Cost</TableHead>}
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Note / Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={ledgerMode === 'PHYSICAL' ? 10 : 8} className="text-center py-12">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Loading movement history...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell
                      colSpan={ledgerMode === 'PHYSICAL' ? 10 : 8}
                      className="text-center py-12 text-destructive font-medium"
                    >
                      Failed to load logs. Please try again.
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={ledgerMode === 'PHYSICAL' ? 10 : 8}
                      className="text-center py-12 text-muted-foreground"
                    >
                      No stock movements found matching filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.performedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 shrink-0 rounded border bg-muted flex items-center justify-center overflow-hidden">
                            {log.image ? (
                              <img src={log.image} alt={log.productName} className="h-full w-full object-cover" />
                            ) : (
                              <Package className="h-4 w-4 text-muted-foreground/50" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium text-sm">{log.productName}{log.variantName ? ` — ${log.variantName}` : ''}</div>
                            <div className="text-xs text-muted-foreground">{log.sku}</div>
                          </div>
                        </div>
                      </TableCell>
                      {ledgerMode === 'PHYSICAL' && (
                        <TableCell className="font-medium text-xs">
                          {log.warehouseName || 'Unknown'}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {log.type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold',
                          log.direction === 'IN' ? 'text-green-600' : 'text-red-600'
                        )}
                      >
                        {log.direction === 'IN' ? '+' : '-'}
                        {log.quantity}
                      </TableCell>
                      {ledgerMode === 'PHYSICAL' && (
                        <TableCell className="text-right text-xs">
                          {log.unitCost != null ? `৳${log.unitCost.toFixed(2)}` : '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {log.stockBefore}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium">
                        {log.stockAfter}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {log.performedBy && log.performedBy.toLowerCase() !== 'system' ? (
                          <UserBadge email={log.performedBy} showEmail={false} size="sm" />
                        ) : (
                          <Badge variant="secondary" className="text-[10px] h-4">System</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={log.reason || log.note}>
                        {log.reason || log.note || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {`${(meta.page - 1) * meta.perPage + 1}-${Math.min(meta.page * meta.perPage, meta.total)} of ${meta.total} movements`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(p + 1, meta.totalPages))}
                disabled={page === meta.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Main>
    </>
  )
}
