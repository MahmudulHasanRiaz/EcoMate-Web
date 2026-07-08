import { useState } from 'react'
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
import { Package, MoreHorizontal, ArrowLeftRight, Edit3, Filter, HelpCircle, AlertTriangle } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { InventoryDetailDrawer } from './components/inventory-detail-drawer'
import { QuickAdjustmentModal } from './components/quick-adjustment-modal'
import { Link } from '@tanstack/react-router'

export function Inventory() {
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustProduct, setAdjustProduct] = useState<string | undefined>()

  const stockLevels = [
    { id: '1', name: 'Organic Cotton T-Shirt', sku: 'OCT-WHT-M', warehouse: 'Main Warehouse', lot: 'L-2023-11', expiry: '—', available: 120, reserved: 5, allocated: 10, onHand: 135, cost: 450, updated: '2 hours ago', status: 'optimal' },
    { id: '2', name: 'Stainless Steel Water Bottle', sku: 'SSWB-750', warehouse: 'Retail Store', lot: '—', expiry: '—', available: 5, reserved: 0, allocated: 0, onHand: 5, cost: 320, updated: 'Yesterday', status: 'low' },
    { id: '3', name: 'Arabica Coffee Beans', sku: 'ACB-250G', warehouse: 'Main Warehouse', lot: 'B-2401', expiry: '2024-12-31', available: 12, reserved: 20, allocated: 0, onHand: 32, cost: 850, updated: '3 days ago', status: 'optimal' },
    { id: '4', name: 'Bamboo Toothbrush', sku: 'BAM-104', warehouse: 'Main Warehouse', lot: 'L-2024-01', expiry: '—', available: -2, reserved: 0, allocated: 0, onHand: -2, cost: 45, updated: '1 hour ago', status: 'negative' },
  ]

  const handleRowClick = (product: any) => {
    setSelectedProduct(product)
    setDetailOpen(true)
  }

  const handleQuickAdjust = (productName?: string) => {
    setAdjustProduct(productName)
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
          <Input placeholder="Search name or SKU..." className="h-9 w-[200px] bg-background" />
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
                {stockLevels.map((p) => (
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
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${p.available < 0 ? 'text-red-600' : p.available < 10 ? 'text-amber-600' : ''}`}>{p.available}</TableCell>
                    <TableCell className='text-right text-orange-600'>{p.reserved}</TableCell>
                    <TableCell className='text-right text-blue-600'>{p.allocated}</TableCell>
                    <TableCell className='text-right font-bold'>{p.onHand}</TableCell>
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
                          <DropdownMenuItem onClick={() => handleQuickAdjust(p.name)}><Edit3 className="mr-2 h-4 w-4" /> Quick Adjust</DropdownMenuItem>
                          <DropdownMenuItem asChild><Link to="/op/inventory/transfers"><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Link></DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>

      <InventoryDetailDrawer 
        open={detailOpen} 
        onOpenChange={setDetailOpen} 
        productDetails={selectedProduct} 
        onAdjust={() => handleQuickAdjust(selectedProduct?.name)}
      />

      <QuickAdjustmentModal 
        open={adjustOpen} 
        onOpenChange={setAdjustOpen} 
        productName={adjustProduct} 
      />
    </>
  )
}
