import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Package, Edit3, ArrowLeftRight, Building2, FileText, Download } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MovementLedger } from './components/movement-ledger'

export function InventoryDetail() {
  const productDetails = {
    name: 'Organic Cotton T-Shirt',
    sku: 'OCT-WHT-M',
    onHand: 135,
    available: 120,
    reserved: 5,
    allocated: 10,
    cost: 150,
  }

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
              {productDetails.name}
            </h1>
            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
              <span>SKU: {productDetails.sku}</span>
              <Badge variant="outline" className="font-mono text-[10px]">INVENTORY CONTROLLED</Badge>
            </div>
          </div>
          
          <div className="flex gap-2 shrink-0">
            <Button variant="outline"><Edit3 className="mr-2 h-4 w-4" /> Adjust</Button>
            <Button variant="outline"><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Button>
            <Button variant="outline"><Download className="mr-2 h-4 w-4" /> Export Report</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Available</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{productDetails.available}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Reserved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{productDetails.reserved}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Allocated</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{productDetails.allocated}</div>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-primary">Total On Hand</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{productDetails.onHand}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="locations" className="w-full">
          <TabsList className="w-full justify-start border-b rounded-none bg-transparent h-auto p-0 mb-6">
            <TabsTrigger value="locations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Locations & Lots</TabsTrigger>
            <TabsTrigger value="ledger" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Movement Ledger</TabsTrigger>
            <TabsTrigger value="pending" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Reservations & Allocations</TabsTrigger>
            <TabsTrigger value="cost" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 py-3">Cost & Valuation</TabsTrigger>
          </TabsList>
          
          <TabsContent value="locations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Physical Locations</CardTitle>
                <CardDescription>Breakdown of stock by warehouse and specific lot.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Lot/Batch</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Qty On Hand</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground"/> Main Warehouse</TableCell>
                      <TableCell><Badge variant="outline">L-2023-11</Badge></TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell>Organic Textiles Co.</TableCell>
                      <TableCell className="text-right font-medium">100</TableCell>
                      <TableCell className="text-right"><Button variant="ghost" size="sm">Lot Info</Button></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground"/> Retail Store</TableCell>
                      <TableCell><Badge variant="outline">L-2023-12</Badge></TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell>Organic Textiles Co.</TableCell>
                      <TableCell className="text-right font-medium">35</TableCell>
                      <TableCell className="text-right"><Button variant="ghost" size="sm">Lot Info</Button></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ledger">
            <Card>
              <CardHeader>
                <CardTitle>Movement Ledger</CardTitle>
                <CardDescription>Comprehensive audit trail of all physical stock movements.</CardDescription>
              </CardHeader>
              <CardContent>
                <MovementLedger />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pending">
             <Card>
              <CardHeader>
                <CardTitle>Pending Operations</CardTitle>
                <CardDescription>Orders currently reserving or allocating stock.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground text-center py-8">
                  No active sales orders reserving this stock.
                </div>
              </CardContent>
            </Card>
          </TabsContent>

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
                    <div className="text-sm text-right">৳{productDetails.cost.toFixed(2)}</div>
                    
                    <div className="text-sm font-medium">Total Inventory Value:</div>
                    <div className="text-sm text-right font-bold">৳{(productDetails.onHand * productDetails.cost).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </Main>
    </>
  )
}
