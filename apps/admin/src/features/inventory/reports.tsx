import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { AlertCircle, TrendingDown, TrendingUp, ArchiveX, Package } from 'lucide-react'

export function Reports() {
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
          <p className='text-muted-foreground'>Analyze stock movements, valuation, and issues.</p>
        </div>
        <Tabs defaultValue='negative' className='w-full space-y-4'>
          <TabsList className='grid grid-cols-4 w-[600px]'>
            <TabsTrigger value='negative'><AlertCircle className='h-4 w-4 mr-2' /> Negative Stock</TabsTrigger>
            <TabsTrigger value='aging'><TrendingDown className='h-4 w-4 mr-2' /> Aging</TabsTrigger>
            <TabsTrigger value='fast'><TrendingUp className='h-4 w-4 mr-2' /> Fast Moving</TabsTrigger>
            <TabsTrigger value='dead'><ArchiveX className='h-4 w-4 mr-2' /> Dead Stock</TabsTrigger>
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
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Negative Qty</TableHead>
                        <TableHead className="text-right">Estimated Value Impact</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                              <Package className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <div>
                              <div className='font-medium text-sm'>Bamboo Toothbrush</div>
                              <div className='text-xs text-muted-foreground'>BAM-104</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>Main Warehouse</TableCell>
                        <TableCell className="text-right text-red-600 font-bold">-2</TableCell>
                        <TableCell className="text-right">৳90.00</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
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
                 <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">0-30 Days</TableHead>
                        <TableHead className="text-right">31-60 Days</TableHead>
                        <TableHead className="text-right">61-90 Days</TableHead>
                        <TableHead className="text-right text-orange-600">90+ Days</TableHead>
                        <TableHead className="text-right">Total Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                              <Package className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <div>
                              <div className='font-medium text-sm'>Organic Cotton T-Shirt</div>
                              <div className='text-xs text-muted-foreground'>OCT-WHT-M</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">50</TableCell>
                        <TableCell className="text-right">35</TableCell>
                        <TableCell className="text-right">50</TableCell>
                        <TableCell className="text-right text-orange-600 font-medium">0</TableCell>
                        <TableCell className="text-right font-bold">135</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                              <Package className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <div>
                              <div className='font-medium text-sm'>Stainless Steel Bottle</div>
                              <div className='text-xs text-muted-foreground'>SSWB-750</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">0</TableCell>
                        <TableCell className="text-right">10</TableCell>
                        <TableCell className="text-right">25</TableCell>
                        <TableCell className="text-right text-orange-600 font-medium">10</TableCell>
                        <TableCell className="text-right font-bold">45</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
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
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Sales (Last 30 Days)</TableHead>
                        <TableHead className="text-right">Current Stock</TableHead>
                        <TableHead className="text-right">Days of Supply Left</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                              <Package className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <div>
                              <div className='font-medium text-sm'>Organic Cotton T-Shirt</div>
                              <div className='text-xs text-muted-foreground'>OCT-WHT-M</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">420</TableCell>
                        <TableCell className="text-right">135</TableCell>
                        <TableCell className="text-right text-amber-600 font-bold">9</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
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
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Last Movement</TableHead>
                        <TableHead className="text-right">Days Stagnant</TableHead>
                        <TableHead className="text-right">Tied Up Capital</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                              <Package className="h-5 w-5 text-muted-foreground/50" />
                            </div>
                            <div>
                              <div className='font-medium text-sm'>Legacy Tote Bag</div>
                              <div className='text-xs text-muted-foreground'>OLD-INV-01</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>2025-11-15</TableCell>
                        <TableCell className="text-right text-red-600 font-bold">235</TableCell>
                        <TableCell className="text-right font-medium">৳4,500.00</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
