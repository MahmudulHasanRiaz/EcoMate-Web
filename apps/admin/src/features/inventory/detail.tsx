import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { useInventoryManagement } from './hooks/use-inventory-management'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Package, Edit3, ArrowLeftRight, Loader2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Route } from '@/routes/_authenticated/op/inventory/detail'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MovementLedger } from './components/movement-ledger'
import { AdjustStockModal } from './components/adjust-stock-modal'
import { invalidateInventoryStockQueries } from './utils/invalidate-inventory'

interface StockItem {
  id: string
  name: string
  slug: string
  sku: string
  type: string
  availabilityMode: string
  managedStockQuantity: number
  availableStock: number | null
  manageStock: boolean
  reservedStock?: number
  _physicalStock?: number | null
  standardCost?: number | null
  basePrice?: number | null
}

interface ValuationEntry {
  id: string
  productId?: string
  name: string
  sku: string | null
  physicalQty: number
  lotRemainingQty: number
  unitCost: number
  fifoValue: number
}

export function InventoryDetail() {
  const { productId } = Route.useSearch()
  const { data: imEnabled = true } = useInventoryManagement()
  const queryClient = useQueryClient()
  const [adjustOpen, setAdjustOpen] = useState(false)

  const { data: stockData, isLoading } = useQuery({
    queryKey: ['inventory-stock-detail', productId],
    queryFn: () =>
      apiClient
        .get<{ data: StockItem[]; meta: { total: number } }>('/inventory/stock-overview', {
          params: { productId, perPage: 1 },
        })
        .then((r) => r.data),
    enabled: !!productId,
  })

  const product = stockData?.data?.[0]

  const { data: physicalRows, isLoading: physicalLoading } = useQuery({
    queryKey: ['inventory-physical-detail', productId],
    queryFn: () =>
      apiClient
        .get<any[]>('/inventory/physical', { params: { productId } })
        .then((r) => r.data),
    enabled: !!productId,
  })

  const { data: valuationData } = useQuery({
    queryKey: ['inventory-valuation-detail', product?.sku],
    queryFn: () =>
      apiClient
        .get<{ items: ValuationEntry[]; totalValue: number }>('/inventory/valuation', {
          params: { search: product?.sku },
        })
        .then((r) => r.data),
    enabled: !!product?.sku,
  })

  const { data: reservations, isLoading: reservationsLoading } = useQuery({
    queryKey: ['inventory-reservations-detail', productId],
    queryFn: () =>
      apiClient
        .get<any[]>('/inventory/physical/reservations', { params: { productId } })
        .then((r) => r.data),
    enabled: !!productId,
  })

  if (!productId) {
    return (
      <>
        <Header fixed>
          <div className='flex items-center gap-2 me-auto'>
            <Button variant='ghost' size='icon' asChild className='shrink-0'>
              <Link to='/op/inventory'><ArrowLeft className='h-4 w-4' /></Link>
            </Button>
            <GlobalSearchBar />
          </div>
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>
        <Main className='flex flex-col gap-6'>
          <div className="text-center py-20 text-muted-foreground">
            No product selected. <Link to="/op/inventory" className="text-primary underline">Back to inventory</Link>
          </div>
        </Main>
      </>
    )
  }

  if (isLoading) {
    return (
      <>
        <Header fixed>
          <div className='flex items-center gap-2 me-auto'>
            <Button variant='ghost' size='icon' asChild className='shrink-0'>
              <Link to='/op/inventory'><ArrowLeft className='h-4 w-4' /></Link>
            </Button>
            <GlobalSearchBar />
          </div>
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>
        <Main className='flex flex-col gap-6'>
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin h-8 w-8" />
          </div>
        </Main>
      </>
    )
  }

  if (!product) {
    return (
      <>
        <Header fixed>
          <div className='flex items-center gap-2 me-auto'>
            <Button variant='ghost' size='icon' asChild className='shrink-0'>
              <Link to='/op/inventory'><ArrowLeft className='h-4 w-4' /></Link>
            </Button>
            <GlobalSearchBar />
          </div>
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>
        <Main className='flex flex-col gap-6'>
          <div className="text-center py-20 text-muted-foreground">
            Product not found.
          </div>
        </Main>
      </>
    )
  }

  const valuationEntry = (valuationData?.items ?? []).find(
    (i) => (i.productId ?? i.id) === product.id,
  )
  const standardCost = product.standardCost ?? product.basePrice ?? null
  const avgUnitCost = valuationEntry
    ? valuationEntry.lotRemainingQty > 0
      ? valuationEntry.fifoValue / valuationEntry.lotRemainingQty
      : valuationEntry.unitCost
    : standardCost
  const totalValue = valuationEntry
    ? valuationEntry.fifoValue
    : standardCost != null
      ? standardCost * product.managedStockQuantity
      : null

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 me-auto'>
          <Button variant='ghost' size='icon' asChild className='shrink-0'>
            <Link to='/op/inventory'><ArrowLeft className='h-4 w-4' /></Link>
          </Button>
          <GlobalSearchBar />
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-col gap-6'>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6 text-muted-foreground" />
              {product.name}
            </h1>
            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
              <span>SKU: {product.sku}</span>
              <Badge variant="outline" className="font-mono text-[10px]">{product.availabilityMode}</Badge>
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            {product.type !== 'variable' && (
              <Button variant="outline" onClick={() => setAdjustOpen(true)}>
                <Edit3 className="mr-2 h-4 w-4" /> Adjust
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/op/inventory/transfers">
                <ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Available</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{product.availableStock === null ? '∞' : product.availableStock}</div>
            </CardContent>
          </Card>
          {imEnabled && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Reserved</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">{product.reservedStock ?? 0}</div>
              </CardContent>
            </Card>
          )}
          {imEnabled && (
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-primary">Managed On Hand</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">{product.managedStockQuantity}</div>
              </CardContent>
            </Card>
          )}
          {imEnabled && product._physicalStock != null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Physical On Hand</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{product._physicalStock}</div>
              </CardContent>
            </Card>
          )}
        </div>

        <Tabs defaultValue={imEnabled ? "locations" : "ledger"} className="w-full">
          <TabsList className="w-full justify-start border-b rounded-none bg-transparent h-auto p-0 mb-6">
            {imEnabled && (
              <TabsTrigger value="locations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Locations & Lots</TabsTrigger>
            )}
            <TabsTrigger value="ledger" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Movement Ledger</TabsTrigger>
            {imEnabled && (
              <TabsTrigger value="pending" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Reservations & Allocations</TabsTrigger>
            )}
            <TabsTrigger value="cost" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Cost & Valuation</TabsTrigger>
          </TabsList>

          {imEnabled && (
          <TabsContent value="locations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Physical Locations</CardTitle>
                <CardDescription>Breakdown of physical stock by warehouse and bin.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Bin</TableHead>
                      <TableHead>Variant</TableHead>
                      <TableHead className="text-right">Qty On Hand</TableHead>
                      <TableHead className="text-right">Reserved</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {physicalLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          <Loader2 className="animate-spin h-5 w-5 mx-auto" />
                        </TableCell>
                      </TableRow>
                    ) : Array.isArray(physicalRows) && physicalRows.length > 0 ? (
                      physicalRows.map((pi: any) => {
                        const variantLabel = pi.variant
                          ? pi.variant.attributeValues
                              ?.map((av: any) => av.attributeValue?.value)
                              .filter(Boolean)
                              .join(' / ') || pi.variant.sku
                          : null
                        return (
                          <TableRow key={pi.id}>
                            <TableCell className="font-medium">{pi.warehouse?.name || '—'}</TableCell>
                            <TableCell className="font-mono text-sm">{pi.binLocation?.code || '—'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{variantLabel || '—'}</TableCell>
                            <TableCell className="text-right font-medium">{pi.quantity}</TableCell>
                            <TableCell className="text-right text-orange-600">{pi.reservedQuantity}</TableCell>
                            <TableCell className="text-right font-medium">{pi.quantity - pi.reservedQuantity}</TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No physical inventory records for this product.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          )}

          <TabsContent value="ledger">
            <Card>
              <CardHeader>
                <CardTitle>Movement Ledger</CardTitle>
                <CardDescription>Comprehensive audit trail of all physical stock movements.</CardDescription>
              </CardHeader>
              <CardContent>
                <MovementLedger productId={product.id} />
              </CardContent>
            </Card>
          </TabsContent>

          {imEnabled && (
          <TabsContent value="pending">
             <Card>
              <CardHeader>
                <CardTitle>Reservations & Allocations</CardTitle>
                <CardDescription>Stock currently reserved by orders and allocations.</CardDescription>
              </CardHeader>
              <CardContent>
                {reservationsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin h-5 w-5" />
                  </div>
                ) : Array.isArray(reservations) && reservations.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Warehouse</TableHead>
                        <TableHead className="text-right">Reserved Qty</TableHead>
                        <TableHead>Reference / Order</TableHead>
                        <TableHead className="text-right">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reservations.map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">
                            {r.warehouse?.name || '—'}
                            {r.isManaged && (
                              <Badge variant="secondary" className="ml-2 text-[10px]">Managed</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium text-orange-600">{r.reservedQuantity}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.order?.displayId ?? r.orderDisplayId ?? r.referenceId ?? '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {r.updatedAt
                              ? new Date(r.updatedAt).toLocaleString()
                              : r.createdAt
                                ? new Date(r.createdAt).toLocaleString()
                                : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No active sales orders reserving this stock.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          <TabsContent value="cost">
             <Card>
              <CardHeader>
                <CardTitle>Valuation & Cost Basis</CardTitle>
                <CardDescription>Financial representation of this physical stock.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 max-w-md">
                    <div className="text-sm font-medium">Average Unit Cost:</div>
                    <div className="text-sm text-right">
                      {avgUnitCost != null ? `৳${Number(avgUnitCost).toFixed(2)}` : '—'}
                    </div>

                    <div className="text-sm font-medium">Total Inventory Value:</div>
                    <div className="text-sm text-right font-bold">
                      {totalValue != null ? `৳${Number(totalValue).toFixed(2)}` : '—'}
                    </div>

                    {valuationEntry && (
                      <>
                        <div className="text-sm font-medium">Physical Qty (lots):</div>
                        <div className="text-sm text-right">{valuationEntry.lotRemainingQty}</div>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {valuationEntry
                      ? 'Source: FIFO costing-lot valuation.'
                      : 'Source: product standard cost (no FIFO costing lots found for this product).'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </Main>

      <AdjustStockModal
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        productId={product.id}
        productName={product.name}
        availabilityMode={product.availabilityMode}
        onSuccess={() => {
          // Finding 3: this page invalidated only its own *-detail keys —
          // the drawer's per-product queries and the lists went stale.
          invalidateInventoryStockQueries(queryClient)
        }}
      />
    </>
  )
}
