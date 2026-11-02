import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { SafeImage } from '@/components/safe-image'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertCircle, TrendingDown, TrendingUp, ArchiveX, Package, Loader2, DollarSign, Download } from 'lucide-react'
import { PageInfo } from '@/components/page-info'

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
  images?: any[]
}

interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

interface FastMovingRow {
  productId: string
  name: string
  sku: string | null
  image: string | null
  qtySold: number
  movements: number
  lastSoldAt: string | null
  price: number | null
}

interface DeadStockRow {
  productId: string
  name: string
  sku: string | null
  image: string | null
  managedQty: number
  physicalQty: number
  lastMovementAt: string | null
  daysSinceMovement: number | null
  totalValue: number
}

interface AgingRow {
  productId: string
  name: string
  sku: string | null
  image: string | null
  stockQty: number
  lotCount: number
  oldestReceivedAt: string | null
  daysInStock: number
  totalValue: number
}

/** Client-side CSV download of the rows a report tab has already loaded. */
function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [
    headers.map(esc).join(','),
    ...rows.map((r) => r.map(esc).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || isNaN(Number(value))) return '—'
  return `৳${Number(value).toFixed(2)}`
}

function ProductCell({ name, sku, image }: { name: string; sku: string | null; image: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
        {image ? (
          <SafeImage src={image} alt={name} className="h-full w-full object-cover" />
        ) : (
          <Package className="h-5 w-5 text-muted-foreground/50" />
        )}
      </div>
      <div>
        <div className='font-medium text-sm'>{name}</div>
        <div className='text-xs text-muted-foreground'>{sku ?? '—'}</div>
      </div>
    </div>
  )
}

const REPORT_PAGE_SIZE = 15

function ClientPager({
  page,
  totalItems,
  onPageChange,
}: {
  page: number
  totalItems: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / REPORT_PAGE_SIZE))
  if (totalItems <= REPORT_PAGE_SIZE) return null
  return (
    <div className="flex items-center justify-between pt-4">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages} ({totalItems} items)
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

function paginate<T>(rows: T[], page: number): T[] {
  const totalPages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  return rows.slice((safePage - 1) * REPORT_PAGE_SIZE, safePage * REPORT_PAGE_SIZE)
}

export function Reports() {
  const [negListPage, setNegListPage] = useState(1)
  const [agingPage, setAgingPage] = useState(1)
  const [fastPage, setFastPage] = useState(1)
  const [deadPage, setDeadPage] = useState(1)

  // Negative stock is a client-side filter, so EVERY stock-overview page
  // must be loaded first — page 1 alone silently missed negatives beyond
  // the first 100 products.
  const {
    data: allStock,
    isLoading: stockLoading,
    error: stockError,
  } = useQuery({
    queryKey: ['stock-overview', 'all-pages'],
    queryFn: async () => {
      const items: StockItem[] = []
      let page = 1
      let totalPages = 1
      do {
        const res = await apiClient
          .get<{ data: StockItem[]; meta: PaginationMeta }>('/inventory/stock-overview', {
            params: { page, perPage: 100 },
          })
          .then((r) => r.data)
        items.push(...(res.data ?? []))
        totalPages = res.meta?.totalPages ?? 1
        page += 1
      } while (page <= totalPages && page <= 20)
      return items
    },
  })

  const { data: physValuation } = useQuery({
    queryKey: ['inventory-valuation-physical'],
    queryFn: () => apiClient.get('/inventory/valuation').then(r => r.data),
  })

  const {
    data: fastData,
    isLoading: fastLoading,
    error: fastError,
  } = useQuery({
    queryKey: ['inventory-reports', 'fast-moving'],
    queryFn: () =>
      apiClient
        .get<{ data: FastMovingRow[]; total: number }>('/inventory/reports/fast-moving')
        .then((r) => r.data),
  })

  const {
    data: deadData,
    isLoading: deadLoading,
    error: deadError,
  } = useQuery({
    queryKey: ['inventory-reports', 'dead-stock'],
    queryFn: () =>
      apiClient
        .get<{ data: DeadStockRow[]; days: number; total: number }>('/inventory/reports/dead-stock', {
          params: { days: 180 },
        })
        .then((r) => r.data),
  })

  const {
    data: agingData,
    isLoading: agingLoading,
    error: agingError,
  } = useQuery({
    queryKey: ['inventory-reports', 'aging'],
    queryFn: () =>
      apiClient
        .get<{ data: AgingRow[]; total: number }>('/inventory/reports/aging')
        .then((r) => r.data),
  })

  useEffect(() => {
    if (stockError) toast.error('Failed to load stock data.')
  }, [stockError])

  useEffect(() => {
    if (agingError) toast.error('Failed to load aging data.')
  }, [agingError])

  useEffect(() => {
    if (fastError) toast.error('Failed to load fast moving data.')
  }, [fastError])

  useEffect(() => {
    if (deadError) toast.error('Failed to load dead stock data.')
  }, [deadError])

  const negativeStock = (allStock ?? []).filter((i) => i.managedStockQuantity < 0)
  const fastRows = fastData?.data ?? []
  const deadRows = deadData?.data ?? []
  const agingRows = agingData?.data ?? []

  const exportNegative = () =>
    downloadCsv(
      'negative-stock.csv',
      ['Product', 'SKU', 'Negative Qty', 'Unit Price', 'Estimated Value Impact'],
      negativeStock.map((i) => [
        i.name,
        i.sku ?? '',
        i.managedStockQuantity,
        i.basePrice ?? 0,
        Math.abs(i.managedStockQuantity) * (i.basePrice || 0),
      ]),
    )

  const exportFast = () =>
    downloadCsv(
      'fast-moving.csv',
      ['Product', 'SKU', 'Qty Sold', 'Movements', 'Last Sold', 'Unit Price'],
      fastRows.map((r) => [
        r.name,
        r.sku ?? '',
        r.qtySold,
        r.movements,
        r.lastSoldAt ? formatDate(r.lastSoldAt) : '',
        r.price ?? 0,
      ]),
    )

  const exportDead = () =>
    downloadCsv(
      'dead-stock.csv',
      ['Product', 'SKU', 'Managed Qty', 'Physical Qty', 'Last Movement', 'Days Since Movement', 'Total Value'],
      deadRows.map((r) => [
        r.name,
        r.sku ?? '',
        r.managedQty,
        r.physicalQty,
        r.lastMovementAt ? formatDate(r.lastMovementAt) : 'Never',
        r.daysSinceMovement ?? '',
        r.totalValue,
      ]),
    )

  const exportAging = () =>
    downloadCsv(
      'stock-aging.csv',
      ['Product', 'SKU', 'Stock Qty', 'Lots', 'Oldest Received', 'Days In Stock', 'Total Value'],
      agingRows.map((r) => [
        r.name,
        r.sku ?? '',
        r.stockQty,
        r.lotCount,
        r.oldestReceivedAt ? formatDate(r.oldestReceivedAt) : '',
        r.daysInStock,
        r.totalValue,
      ]),
    )

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-col gap-6'>
        <div>
          <div className='flex items-center gap-1.5'>
            <h1 className='text-2xl font-bold tracking-tight'>Inventory Reports</h1>
          </div>
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
                <Button variant="outline" size="sm" onClick={exportNegative} disabled={negativeStock.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>
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
                  <>
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
                            paginate(negativeStock, negListPage).map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <ProductCell
                                    name={item.name}
                                    sku={item.sku}
                                    image={Array.isArray(item.images) && item.images.length && typeof item.images[0] === 'string' ? item.images[0] : null}
                                  />
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
                    <ClientPager page={negListPage} totalItems={negativeStock.length} onPageChange={setNegListPage} />
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='aging' className='space-y-4'>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Inventory Aging Report</CardTitle>
                  <CardDescription>How long stock has been sitting in the warehouse, based on the oldest open FIFO costing lot per product.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={exportAging} disabled={agingRows.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>
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
                            <TableHead className="text-right">Stock Qty</TableHead>
                            <TableHead className="text-right">Lots</TableHead>
                            <TableHead className="text-right">Oldest Received</TableHead>
                            <TableHead className="text-right">Days In Stock</TableHead>
                            <TableHead className="text-right">Total Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {agingRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                                No aging data available.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginate(agingRows, agingPage).map((row) => (
                              <TableRow key={row.productId}>
                                <TableCell>
                                  <ProductCell name={row.name} sku={row.sku} image={row.image} />
                                </TableCell>
                                <TableCell className="text-right font-bold">{row.stockQty}</TableCell>
                                <TableCell className="text-right">{row.lotCount}</TableCell>
                                <TableCell className="text-right text-sm">{formatDate(row.oldestReceivedAt)}</TableCell>
                                <TableCell className="text-right font-medium">{row.daysInStock}</TableCell>
                                <TableCell className="text-right font-medium">{formatMoney(row.totalValue)}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <ClientPager page={agingPage} totalItems={agingRows.length} onPageChange={setAgingPage} />
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
                  <CardDescription>Products ranked by total quantity sold — high-turnover items that require frequent replenishment.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={exportFast} disabled={fastRows.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                {fastLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="animate-spin h-6 w-6" />
                  </div>
                ) : fastError ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <AlertCircle className="h-6 w-6 mb-2" />
                    <p className="text-sm">Failed to load fast moving data.</p>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Qty Sold</TableHead>
                            <TableHead className="text-right">Movements</TableHead>
                            <TableHead className="text-right">Last Sold</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fastRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                                No sales data available.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginate(fastRows, fastPage).map((row) => (
                              <TableRow key={row.productId}>
                                <TableCell>
                                  <ProductCell name={row.name} sku={row.sku} image={row.image} />
                                </TableCell>
                                <TableCell className="text-right font-bold">{row.qtySold}</TableCell>
                                <TableCell className="text-right">{row.movements}</TableCell>
                                <TableCell className="text-right text-sm">{formatDate(row.lastSoldAt)}</TableCell>
                                <TableCell className="text-right">{formatMoney(row.price)}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <ClientPager page={fastPage} totalItems={fastRows.length} onPageChange={setFastPage} />
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
                  <CardDescription>Products holding stock with no movement in the last 180 days — candidates for clearance or liquidation.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={exportDead} disabled={deadRows.length === 0}>
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>
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
                            <TableHead className="text-right">Managed Qty</TableHead>
                            <TableHead className="text-right">Physical Qty</TableHead>
                            <TableHead className="text-right">Last Movement</TableHead>
                            <TableHead className="text-right">Days Since Movement</TableHead>
                            <TableHead className="text-right">Total Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deadRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                                No dead stock items found.
                              </TableCell>
                            </TableRow>
                          ) : (
                            paginate(deadRows, deadPage).map((row) => (
                              <TableRow key={row.productId}>
                                <TableCell>
                                  <ProductCell name={row.name} sku={row.sku} image={row.image} />
                                </TableCell>
                                <TableCell className="text-right font-bold">{row.managedQty}</TableCell>
                                <TableCell className="text-right">{row.physicalQty}</TableCell>
                                <TableCell className="text-right text-sm">
                                  {row.lastMovementAt ? formatDate(row.lastMovementAt) : 'Never'}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {row.daysSinceMovement != null ? row.daysSinceMovement : '—'}
                                </TableCell>
                                <TableCell className="text-right font-medium">{formatMoney(row.totalValue)}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <ClientPager page={deadPage} totalItems={deadRows.length} onPageChange={setDeadPage} />
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
