import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertCircle, TrendingDown, TrendingUp, ArchiveX, Package, Loader2, DollarSign } from 'lucide-react'

interface LogEntry {
  id: string
  productId: string
  productName: string
  variantName: string | null
  comboName: string | null
  quantity: number
  direction: string
  type: string
  stockBefore: number
  stockAfter: number
  note: string | null
  performedBy: string | null
  performedAt: string
}

interface StockItem {
  id: string
  name: string
  slug: string
  sku: string | null
  type: string
  managedStockQuantity: number
  manageStock: boolean
  lowStockQty: number | null
  basePrice: number | null
  salePrice: number | null
}

interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export function Reports() {
  const [negPage, setNegPage] = useState(1)
  const [agingPage, setAgingPage] = useState(1)
  const [fastPage, setFastPage] = useState(1)
  const [deadPage, setDeadPage] = useState(1)

  const perPage = 10

  const {
    data: stockData,
    isLoading: stockLoading,
    error: stockError,
  } = useQuery({
    queryKey: ['stock-overview', 1, 100],
    queryFn: () =>
      apiClient
        .get<{ data: StockItem[]; meta: PaginationMeta }>('/inventory/stock-overview', {
          params: { page: 1, perPage: 100 },
        })
        .then((r) => r.data),
  })

  const { data: physValuation } = useQuery({
    queryKey: ['inventory-valuation-physical'],
    queryFn: () => apiClient.get('/inventory/valuation').then(r => r.data),
  })

  const {
    data: agingData,
    isLoading: agingLoading,
    error: agingError,
  } = useQuery({
    queryKey: ['stock-overview', agingPage, perPage],
    queryFn: () =>
      apiClient
        .get<{ data: StockItem[]; meta: PaginationMeta }>('/inventory/stock-overview', {
          params: { page: agingPage, perPage },
        })
        .then((r) => r.data),
  })

  const {
    data: saleData,
    isLoading: saleLoading,
    error: saleError,
  } = useQuery({
    queryKey: ['inventory-logs', 'sale', fastPage],
    queryFn: () =>
      apiClient
        .get<{ data: LogEntry[]; meta: PaginationMeta }>('/inventory/logs', {
          params: { page: fastPage, perPage, type: 'sale' },
        })
        .then((r) => r.data),
  })

  const {
    data: deadData,
    isLoading: deadLoading,
    error: deadError,
  } = useQuery({
    queryKey: ['inventory-logs', 'return', deadPage],
    queryFn: () =>
      apiClient
        .get<{ data: LogEntry[]; meta: PaginationMeta }>('/inventory/logs', {
          params: { page: deadPage, perPage, type: 'return' },
        })
        .then((r) => r.data),
  })

  useEffect(() => {
    if (stockError) toast.error('Failed to load stock data.')
  }, [stockError])

  useEffect(() => {
    if (agingError) toast.error('Failed to load aging data.')
  }, [agingError])

  useEffect(() => {
    if (saleError) toast.error('Failed to load sales data.')
  }, [saleError])

  useEffect(() => {
    if (deadError) toast.error('Failed to load dead stock data.')
  }, [deadError])

  const negativeStock = (stockData?.data || []).filter((i) => i.managedStockQuantity < 0)
  const agingList = agingData?.data || []
  const saleList = saleData?.data || []
  const deadList = deadData?.data || []

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-col gap-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Inventory Reports</h1>
          <p className='text-muted-foreground'>Analyze managed stock movements and physical inventory valuation.</p>
        </div>
        <Tabs defaultValue='negative' className='w-full space-y-4'>
          <TabsList className='grid grid-cols-5 w-[700px]'>
            <TabsTrigger value='negative'><AlertCircle className='h-4 w-4 mr-2' /> Negative Stock</TabsTrigger>
            <TabsTrigger value='aging'><TrendingDown className='h-4 w-4 mr-2' /> Aging</TabsTrigger>
            <TabsTrigger value='fast'><TrendingUp className='h-4 w-4 mr-2' /> Fast Moving</TabsTrigger>
            <TabsTrigger value='dead'><ArchiveX className='h-4 w-4 mr-2' /> Dead Stock</TabsTrigger>
            <TabsTrigger value='valuation'><DollarSign className='h-4 w-4 mr-2' /> Valuation</TabsTrigger>
          </TabsList>

          <TabsContent value='negative' className='space-y-4'>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Negative Stock Report</CardTitle>
                  <CardDescription>Items that have a stock quantity below zero, usually indicating missing receipts or over-shipment.</CardDescription>
                </div>
                <Button variant="outline" size="sm">Export CSV</Button>
              </CardHeader>
              <CardContent>
                {stockLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin h-6 w-6" />
                  </div>
                ) : stockError ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <AlertCircle className="h-6 w-6 mb-2" />
                    <p className="text-sm">Failed to load stock data.</p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Negative Qty</TableHead>
                          <TableHead className="text-right">Estimated Value Impact</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {negativeStock.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
                              No items with negative stock.
                            </TableCell>
                          </TableRow>
                        ) : (
                          negativeStock.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                                    <Package className="h-5 w-5 text-muted-foreground/50" />
                                  </div>
                                  <div>
                                    <div className='font-medium text-sm'>{item.name}</div>
                                    <div className='text-xs text-muted-foreground'>{item.slug}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-red-600 font-bold">
                                {item.managedStockQuantity}
                              </TableCell>
                              <TableCell className="text-right">
                                ৳{(Math.abs(item.managedStockQuantity) * (item.basePrice || 0)).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='aging' className='space-y-4'>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Inventory Aging Report</CardTitle>
                  <CardDescription>Track how long items have been sitting in the warehouse.</CardDescription>
                </div>
                <Button variant="outline" size="sm">Export CSV</Button>
              </CardHeader>
              <CardContent>
                {agingLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin h-6 w-6" />
                  </div>
                ) : agingError ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <AlertCircle className="h-6 w-6 mb-2" />
                    <p className="text-sm">Failed to load aging data.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Current Stock</TableHead>
                            <TableHead className="text-right">Low Stock Threshold</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-right">Total Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {agingList.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                                No stock data available.
                              </TableCell>
                            </TableRow>
                          ) : (
                            agingList.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                                      <Package className="h-5 w-5 text-muted-foreground/50" />
                                    </div>
                                    <div>
                                      <div className='font-medium text-sm'>{item.name}</div>
                                      <div className='text-xs text-muted-foreground'>{item.slug}</div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-bold">
                                  {item.managedStockQuantity}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.lowStockQty ?? '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {item.basePrice != null ? `৳${Number(item.basePrice).toFixed(2)}` : '-'}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {item.basePrice != null
                                    ? `৳${(Number(item.basePrice) * item.managedStockQuantity).toFixed(2)}`
                                    : '-'}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {agingData?.meta && (
                      <div className="flex items-center justify-between pt-4">
                        <p className="text-sm text-muted-foreground">
                          Page {agingData.meta.page} of {agingData.meta.totalPages} ({agingData.meta.total} items)
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={agingPage <= 1}
                            onClick={() => setAgingPage((p) => p - 1)}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={agingPage >= (agingData.meta.totalPages || 1)}
                            onClick={() => setAgingPage((p) => p + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='fast' className='space-y-4'>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Fast Moving Items</CardTitle>
                  <CardDescription>High-turnover products that require frequent replenishment.</CardDescription>
                </div>
                <Button variant="outline" size="sm">Export CSV</Button>
              </CardHeader>
              <CardContent>
                {saleLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin h-6 w-6" />
                  </div>
                ) : saleError ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <AlertCircle className="h-6 w-6 mb-2" />
                    <p className="text-sm">Failed to load sales data.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Qty Sold</TableHead>
                            <TableHead className="text-right">Stock After</TableHead>
                            <TableHead className="text-right">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {saleList.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                                No sales data available.
                              </TableCell>
                            </TableRow>
                          ) : (
                            saleList.map((log) => (
                              <TableRow key={log.id}>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                                      <Package className="h-5 w-5 text-muted-foreground/50" />
                                    </div>
                                    <div>
                                      <div className='font-medium text-sm'>{log.productName}</div>
                                      <div className='text-xs text-muted-foreground'>
                                        {[log.variantName, log.comboName].filter(Boolean).join(' / ') || log.type}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-medium">{log.quantity}</TableCell>
                                <TableCell className="text-right">{log.stockAfter}</TableCell>
                                <TableCell className="text-right text-sm">
                                  {new Date(log.performedAt).toLocaleDateString()}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {saleData?.meta && (
                      <div className="flex items-center justify-between pt-4">
                        <p className="text-sm text-muted-foreground">
                          Page {saleData.meta.page} of {saleData.meta.totalPages} ({saleData.meta.total} items)
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={fastPage <= 1}
                            onClick={() => setFastPage((p) => p - 1)}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={fastPage >= (saleData.meta.totalPages || 1)}
                            onClick={() => setFastPage((p) => p + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='dead' className='space-y-4'>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Dead Stock</CardTitle>
                  <CardDescription>Items with no movement in the last 180 days that may require liquidation.</CardDescription>
                </div>
                <Button variant="outline" size="sm">Export CSV</Button>
              </CardHeader>
              <CardContent>
                {deadLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin h-6 w-6" />
                  </div>
                ) : deadError ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <AlertCircle className="h-6 w-6 mb-2" />
                    <p className="text-sm">Failed to load dead stock data.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead>Note</TableHead>
                            <TableHead className="text-right">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deadList.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                                No dead stock items found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            deadList.map((log) => (
                              <TableRow key={log.id}>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                                      <Package className="h-5 w-5 text-muted-foreground/50" />
                                    </div>
                                    <div>
                                      <div className='font-medium text-sm'>{log.productName}</div>
                                      <div className='text-xs text-muted-foreground'>
                                        {[log.variantName, log.comboName].filter(Boolean).join(' / ') || log.type}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-bold">{log.quantity}</TableCell>
                                <TableCell className="text-sm">{log.note || '-'}</TableCell>
                                <TableCell className="text-right text-sm">
                                  {new Date(log.performedAt).toLocaleDateString()}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {deadData?.meta && (
                      <div className="flex items-center justify-between pt-4">
                        <p className="text-sm text-muted-foreground">
                          Page {deadData.meta.page} of {deadData.meta.totalPages} ({deadData.meta.total} items)
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deadPage <= 1}
                            onClick={() => setDeadPage((p) => p - 1)}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deadPage >= (deadData.meta.totalPages || 1)}
                            onClick={() => setDeadPage((p) => p + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='valuation' className='space-y-4'>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Physical Inventory Valuation</CardTitle>
                  <CardDescription>FIFO valuation based on CostingLot remaining quantities.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {physValuation?.items?.length ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
                      <span className="text-sm font-medium">Total Inventory Value</span>
                      <span className="text-lg font-bold text-primary">৳{physValuation.totalValue?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Physical Qty</TableHead>
                          <TableHead className="text-right">Lot Remaining</TableHead>
                          <TableHead className="text-right">FIFO Value</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {physValuation.items.map((item: any) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <div className="font-medium text-sm">{item.name}</div>
                              <div className="text-xs text-muted-foreground">{item.sku}</div>
                            </TableCell>
                            <TableCell className="text-right">{item.physicalQty}</TableCell>
                            <TableCell className="text-right">{item.lotRemainingQty}</TableCell>
                            <TableCell className="text-right font-bold">৳{item.fifoValue?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                            <TableCell>
                              {item.reconciliationStatus === 'OK' ? (
                                <Badge variant='default' className='bg-green-500 text-xs'>OK</Badge>
                              ) : (
                                <Badge variant='outline' className='border-amber-500 text-amber-600 text-xs'>Reconcile</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No physical inventory valuation data</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
