import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { useInventoryManagement } from './hooks/use-inventory-management'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DollarSign, AlertTriangle, Package, TrendingDown, FileEdit } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { MOVEMENT_TYPE_LABELS } from './utils/movement-type-labels'
import { UserBadge } from '@/components/user-badge'

type LowStockItem = {
  id: string
  name: string
  slug: string
  stock: number
  lowStockQty: number | null
  sku: string | null
  type: 'product' | 'variant'
  variantSku?: string
  variantAttributes?: string
}

type LowStockResponse = {
  products: LowStockItem[]
  count: number
}

type StockOverviewResponse = {
  data: unknown[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

type ValuationResponse = {
  totalValue: number
  totalStock: number
  count: number
}

type InventoryLog = {
  id: string
  productId: string | null
  variantId: string | null
  quantity: number
  type: string
  reason: string | null
  performedBy: string | null
  createdAt: string
  productName: string | null
  variantName: string | null
}

type LogsResponse = {
  data: InventoryLog[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function formatCurrency(value: number): string {
  return `৳${value.toLocaleString('en-BD')}`
}

export function StockOverview() {
  const { data: lowStock, isLoading: lowStockLoading } = useQuery<LowStockResponse>({
    queryKey: ['inventory', 'low-stock'],
    queryFn: () => apiClient.get('/inventory/low-stock').then(r => r.data),
    refetchInterval: 60000,
  })

  const { data: stockOverview, isLoading: stockLoading } = useQuery<StockOverviewResponse>({
    queryKey: ['inventory', 'stock-overview'],
    queryFn: () => apiClient.get('/inventory/stock-overview', { params: { perPage: 1 } }).then(r => r.data),
    refetchInterval: 60000,
  })

  const { data: valuation, isLoading: valuationLoading } = useQuery<ValuationResponse>({
    queryKey: ['inventory', 'valuation'],
    queryFn: () => apiClient.get('/inventory/valuation').then(r => r.data),
    refetchInterval: 60000,
  })

  const { data: imEnabled = true } = useInventoryManagement()

  const { data: physReplenishment, isLoading: physReplLoading } = useQuery({
    queryKey: ['inventory', 'replenishment'],
    queryFn: () => apiClient.get('/inventory/replenishment').then(r => r.data),
    refetchInterval: 60000,
  })

  const { data: logsData, isLoading: logsLoading } = useQuery<LogsResponse>({
    queryKey: ['inventory', 'logs'],
    queryFn: () => apiClient.get('/inventory/logs', { params: { perPage: 5 } }).then(r => r.data),
    refetchInterval: 30000,
  })

  const totalProducts = stockOverview?.meta.total ?? 0
  const lowStockCount = lowStock?.count ?? 0
  const inStockCount = totalProducts - lowStockCount
  const totalValue = valuation?.totalValue ?? 0

  const loading = lowStockLoading || stockLoading || valuationLoading
  const lowStockProducts = lowStock?.products ?? []
  const logs = logsData?.data ?? []

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-col gap-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Inventory Overview</h1>
          <p className='text-muted-foreground'>High-level snapshot of managed stock and physical inventory operations.</p>
        </div>

        {loading ? (
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                  <Skeleton className='h-4 w-28' />
                  <Skeleton className='h-4 w-4' />
                </CardHeader>
                <CardContent>
                  <Skeleton className='h-8 w-20 mb-1' />
                  <Skeleton className='h-3 w-36' />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Total Products</CardTitle>
                <Package className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>{totalProducts.toLocaleString()}</div>
                <p className='text-xs text-muted-foreground'>Active products in catalog</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Low Stock Alerts</CardTitle>
                <AlertTriangle className='h-4 w-4 text-amber-500' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold text-amber-600'>{lowStockCount}</div>
                <p className='text-xs text-muted-foreground'>Items below minimum threshold</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>In Stock</CardTitle>
                <TrendingDown className='h-4 w-4 text-emerald-500' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold text-emerald-600'>{inStockCount.toLocaleString()}</div>
                <p className='text-xs text-muted-foreground'>Products with adequate stock</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Total Inventory Value</CardTitle>
                <DollarSign className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>{formatCurrency(totalValue)}</div>
                <p className='text-xs text-muted-foreground'>Aggregated across all warehouses</p>
              </CardContent>
            </Card>
          </div>
        )}

        <div className='grid gap-4 md:grid-cols-2'>
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" /> Managed Stock — Requires Attention
              </CardTitle>
              <CardDescription>Virtual stock items below threshold (managed stock).</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {lowStockLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              ) : lowStockProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Package className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No low stock items</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {lowStockProducts.slice(0, 5).map((item) => (
                    <div key={item.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 shrink-0 rounded border bg-muted flex items-center justify-center overflow-hidden">
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground/50" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-medium leading-none">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.type === 'variant' && item.variantAttributes
                              ? `${item.sku ?? ''} - ${item.variantAttributes}`
                              : item.sku}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-amber-600">{item.stock} left</p>
                        <p className="text-xs text-muted-foreground">Min: {item.lowStockQty ?? 5}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            <div className="p-4 pt-0 mt-auto">
              <Button variant="outline" className="w-full" asChild>
                <Link to="/op/inventory" search={{ filter: 'low_stock' }}>View all low stock</Link>
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileEdit className="h-5 w-5 text-muted-foreground" /> Recent Adjustments
              </CardTitle>
              <CardDescription>Stock corrections made recently.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              {logsLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ))}
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <FileEdit className="h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No recent adjustments</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none flex items-center gap-2">
                          {log.productName ?? 'Unknown product'}
                          <Badge variant="secondary" className="text-[10px]">
                            {MOVEMENT_TYPE_LABELS[log.type] ?? log.type}
                          </Badge>
                        </p>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                          <span>{log.reason ?? ''}</span>
                          {log.performedBy && (
                            <>
                              <span>by</span>
                              {log.performedBy.toLowerCase() !== 'system' ? (
                                <UserBadge email={log.performedBy} showEmail={false} size="sm" />
                              ) : (
                                <Badge variant="secondary" className="text-[10px] h-4">System</Badge>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        {formatTimeAgo(log.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
            <div className="p-4 pt-0 mt-auto">
              <Button variant="outline" className="w-full" asChild>
                <Link to="/op/inventory/adjustments">View all adjustments</Link>
              </Button>
            </div>
          </Card>
        </div>

        {imEnabled && physReplenishment && physReplenishment.products && physReplenishment.products.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-600">
                <AlertTriangle className="h-5 w-5" /> Physical Inventory — Replenishment Needed
              </CardTitle>
              <CardDescription>Products where physical available stock is at or below threshold.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {physReplenishment.products.slice(0, 10).map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-blue-600">{Number(item.available)} available</p>
                      <p className="text-xs text-muted-foreground">Threshold: {Number(item.threshold)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}
