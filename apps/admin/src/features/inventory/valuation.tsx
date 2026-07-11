import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, DollarSign, Package, HelpCircle, Loader2, AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

interface PhysicalValuationItem {
  id: string
  type: string
  name: string
  sku: string
  physicalQty: number
  physicalReserved: number
  lotRemainingQty: number
  unitCost: number
  fifoValue: number
  reconciliationStatus: string
}

interface ManagedValuationItem {
  id: string
  type: string
  name?: string
  sku: string
  stock: number
  unitCost: number
  totalValue: number
}

export function InventoryValuation() {
  const [search, setSearch] = useState('')

  const { data: physData, isLoading: physLoading, error: physError } = useQuery({
    queryKey: ['inventory-valuation-physical', search],
    queryFn: () =>
      apiClient.get('/inventory/valuation', { params: { search: search || undefined } }).then(r => r.data),
  })

  const { data: managedData, isLoading: managedLoading, error: managedError } = useQuery({
    queryKey: ['inventory-valuation-managed', search],
    queryFn: () =>
      apiClient.get('/inventory/valuation/managed', { params: { search: search || undefined } }).then(r => r.data),
  })

  useEffect(() => {
    if (physError) toast.error('Failed to load physical valuation data.')
    if (managedError) toast.error('Failed to load managed stock value data.')
  }, [physError, managedError])

  const physItems: PhysicalValuationItem[] = physData?.items ?? []
  const physTotalValue = physData?.totalValue ?? 0
  const physTotalQty = physData?.totalPhysicalQty ?? 0
  const physTotalLotQty = physData?.totalLotQty ?? 0
  const physCount = physData?.count ?? 0
  const reconciliationNeeded = physItems.filter(i => i.reconciliationStatus === 'RECONCILIATION_NEEDED').length

  const managedItems: ManagedValuationItem[] = managedData?.items ?? []
  const managedTotalValue = managedData?.totalValue ?? 0
  const managedTotalStock = managedData?.totalStock ?? 0

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 me-auto'>
          <Button variant='ghost' size='icon' asChild className='shrink-0'>
            <Link to='/op/inventory'><ArrowLeft className='h-4 w-4' /></Link>
          </Button>
          <GlobalSearchBar className='me-auto' />
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Inventory Valuation</h2>
          <p className='text-muted-foreground text-sm'>
            Financial value of inventory based on cost layers.
          </p>
        </div>

        <Tabs defaultValue="physical" className="w-full">
          <TabsList className="w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0 h-auto">
            <TabsTrigger value="physical" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">
              Inventory Valuation (Physical FIFO)
            </TabsTrigger>
            <TabsTrigger value="managed" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 text-xs">
              Managed Stock Value
            </TabsTrigger>
          </TabsList>

          {/* Physical Inventory Valuation */}
          <TabsContent value="physical" className="space-y-6 pt-4">
            <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
              <Card className="bg-primary/5 border-primary/20">
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium text-primary'>Total Inventory Value</CardTitle>
                  <DollarSign className='h-4 w-4 text-primary' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold text-primary'>
                    ৳{physTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-primary/70 mt-1">FIFO costing basis</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium text-muted-foreground'>Physical Quantity</CardTitle>
                  <Package className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold'>{physTotalQty.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">Units on hand</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium text-muted-foreground'>Costing Layers</CardTitle>
                  <Package className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold'>{physTotalLotQty.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">Lot remaining units</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium text-muted-foreground'>Reconciliation</CardTitle>
                  {reconciliationNeeded > 0 ? (
                    <AlertTriangle className='h-4 w-4 text-amber-500' />
                  ) : (
                    <CheckCircle className='h-4 w-4 text-green-500' />
                  )}
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold'>
                    {reconciliationNeeded > 0 ? (
                      <span className="text-amber-600">{reconciliationNeeded}</span>
                    ) : (
                      <span className="text-green-600">OK</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {reconciliationNeeded > 0 ? 'Products need reconciliation' : 'All aligned'}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className='pb-2 border-b'>
                <CardTitle className='text-base'>Physical Inventory Valuation Details</CardTitle>
                <CardDescription>FIFO valuation based on CostingLot remaining quantities</CardDescription>
              </CardHeader>
              <div className="p-4 border-b bg-muted/20">
                <Input
                  placeholder="Search product or SKU..."
                  className="max-w-sm bg-background"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className='text-right'>Physical Qty</TableHead>
                      <TableHead className='text-right'>Lot Remaining</TableHead>
                      <TableHead className='text-right'>Unit Cost</TableHead>
                      <TableHead className='text-right'>FIFO Value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {physLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10">
                          <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : physItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          <Package className="h-5 w-5 mx-auto mb-2" />
                          No physical inventory found
                        </TableCell>
                      </TableRow>
                    ) : (
                      physItems.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <div className='font-medium text-sm'>{item.name}</div>
                              <div className='text-xs text-muted-foreground'>{item.sku}</div>
                            </div>
                          </TableCell>
                          <TableCell className='text-right font-medium'>{item.physicalQty}</TableCell>
                          <TableCell className='text-right'>{item.lotRemainingQty}</TableCell>
                          <TableCell className='text-right'>৳{item.unitCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell className='text-right font-bold'>৳{item.fifoValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>
                            {item.reconciliationStatus === 'OK' ? (
                              <Badge variant='default' className='bg-green-500 text-xs'>OK</Badge>
                            ) : (
                              <Badge variant='outline' className='border-amber-500 text-amber-600 text-xs'>Reconcile</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Managed Stock Value */}
          <TabsContent value="managed" className="space-y-6 pt-4">
            <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium text-muted-foreground'>Total Managed Stock Value</CardTitle>
                  <DollarSign className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold'>
                    ৳{managedTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Based on standard cost</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium text-muted-foreground'>Total Units</CardTitle>
                  <Package className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold'>{managedTotalStock.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium text-muted-foreground'>Avg Cost/Unit</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-3xl font-bold'>
                    ৳{(managedTotalValue / (managedTotalStock || 1)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className='pb-2 border-b'>
                <CardTitle className='text-base'>Managed Stock Value Details</CardTitle>
                <CardDescription>Lightweight stock value based on standard cost</CardDescription>
              </CardHeader>
              <CardContent className='p-0'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className='text-right'>Stock Qty</TableHead>
                      <TableHead className='text-right'>Standard Cost</TableHead>
                      <TableHead className='text-right'>Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {managedLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10">
                          <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ) : managedItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                          No managed stock products found
                        </TableCell>
                      </TableRow>
                    ) : (
                      managedItems.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div>
                              <div className='font-medium text-sm'>{item.name || item.sku}</div>
                              <div className='text-xs text-muted-foreground'>{item.sku}</div>
                            </div>
                          </TableCell>
                          <TableCell className='text-right font-medium'>{item.stock}</TableCell>
                          <TableCell className='text-right'>৳{item.unitCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell className='text-right font-bold'>৳{item.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
