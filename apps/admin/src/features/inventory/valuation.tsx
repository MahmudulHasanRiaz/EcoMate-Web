import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, Download, DollarSign, Package, TrendingUp, HelpCircle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Link } from '@tanstack/react-router'

export function InventoryValuation() {
  const valuationItems = [
    { id: '1', name: 'Organic Cotton T-Shirt', sku: 'OCT-WHT-M', category: 'Apparel', onHand: 135, avgCost: 150, value: 20250 },
    { id: '2', name: 'Stainless Steel Water Bottle', sku: 'SSWB-750', category: 'Accessories', onHand: 45, avgCost: 320, value: 14400 },
    { id: '3', name: 'Arabica Coffee Beans', sku: 'ACB-250G', category: 'Grocery', onHand: 32, avgCost: 850, value: 27200 },
  ]

  const totalValue = valuationItems.reduce((acc, item) => acc + item.value, 0)
  const totalStock = valuationItems.reduce((acc, item) => acc + item.onHand, 0)

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
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Inventory Valuation</h2>
            <p className='text-muted-foreground text-sm'>
              Financial representation of physical stock currently On Hand.
            </p>
          </div>
          <div className="flex gap-2">
            <Select defaultValue="fifo">
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Costing Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fifo">FIFO (Default)</SelectItem>
                <SelectItem value="avg">Average Cost</SelectItem>
                <SelectItem value="last">Last Purchase Price</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline"><Download className="mr-2 h-4 w-4" /> Export</Button>
          </div>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-sm font-medium text-primary'>Total Asset Value</CardTitle>
              <DollarSign className='h-4 w-4 text-primary' />
            </CardHeader>
            <CardContent>
              <div className='text-3xl font-bold text-primary'>
                ৳{totalValue.toLocaleString(undefined, {minimumFractionDigits: 2})}
              </div>
              <p className="text-xs text-primary/70 mt-1">Based on selected costing method</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-sm font-medium text-muted-foreground'>Total Units On Hand</CardTitle>
              <Package className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-3xl font-bold'>
                {totalStock.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-sm font-medium text-muted-foreground'>Value Density</CardTitle>
              <TrendingUp className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-3xl font-bold'>
                ৳{(totalValue / (totalStock || 1)).toLocaleString(undefined, {maximumFractionDigits: 2})}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Average value per unit</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Value by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span>Apparel</span>
                  <span className="font-medium">৳20,250.00</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Grocery</span>
                  <span className="font-medium">৳27,200.00</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Accessories</span>
                  <span className="font-medium">৳14,400.00</span>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Value by Warehouse</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span>Main Warehouse</span>
                  <span className="font-medium">৳45,600.00</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Retail Store</span>
                  <span className="font-medium">৳16,250.00</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className='pb-2 border-b'>
            <div className='flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between'>
              <div>
                <CardTitle className='text-base'>Valuation Details</CardTitle>
                <CardDescription>Line by line breakdown of stock value.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <div className="p-4 border-b bg-muted/20 flex gap-4">
             <Input placeholder="Search product or SKU..." className="max-w-sm bg-background" />
             <Select defaultValue="all">
               <SelectTrigger className="w-[180px] bg-background"><SelectValue placeholder="Category" /></SelectTrigger>
               <SelectContent><SelectItem value="all">All Categories</SelectItem></SelectContent>
             </Select>
          </div>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TooltipProvider>
                    <TableHead className='text-right'>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center justify-end w-full gap-1">On Hand <HelpCircle className="h-3 w-3 text-muted-foreground"/></TooltipTrigger>
                        <TooltipContent>Physical stock used for valuation</TooltipContent>
                      </Tooltip>
                    </TableHead>
                  </TooltipProvider>
                  <TableHead className='text-right'>Unit Cost</TableHead>
                  <TableHead className='text-right'>Total Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valuationItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 rounded-md border bg-muted flex items-center justify-center overflow-hidden">
                          <Package className="h-5 w-5 text-muted-foreground/50" />
                        </div>
                        <div>
                          <div className='font-medium text-sm'>{item.name}</div>
                          <div className='text-xs text-muted-foreground'>{item.sku}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline' className='text-xs'>
                        {item.category}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right font-medium'>
                      {item.onHand}
                    </TableCell>
                    <TableCell className='text-right'>
                      ৳{item.avgCost.toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </TableCell>
                    <TableCell className='text-right font-bold'>
                      ৳{item.value.toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
