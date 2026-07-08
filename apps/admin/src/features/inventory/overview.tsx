import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowRight, DollarSign, AlertTriangle, Truck, FileEdit, ArchiveX, TrendingDown } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export function StockOverview() {
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
          <p className='text-muted-foreground'>High-level snapshot of your physical stock operations.</p>
        </div>

        {/* Top KPIs */}
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Total Inventory Value</CardTitle>
              <DollarSign className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold'>৳1,245,000</div>
              <p className='text-xs text-muted-foreground'>Aggregated across all warehouses</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Low Stock Alerts</CardTitle>
              <AlertTriangle className='h-4 w-4 text-amber-500' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold text-amber-600'>12</div>
              <p className='text-xs text-muted-foreground'>Items below minimum threshold</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Pending Transfers</CardTitle>
              <Truck className='h-4 w-4 text-blue-500' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold text-blue-600'>4</div>
              <p className='text-xs text-muted-foreground'>Awaiting receipt or in transit</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Dead Stock Warning</CardTitle>
              <ArchiveX className='h-4 w-4 text-red-500' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-bold text-red-600'>8</div>
              <p className='text-xs text-muted-foreground'>Items with no movement &gt;180 days</p>
            </CardContent>
          </Card>
        </div>

        <div className='grid gap-4 md:grid-cols-2'>
          {/* Actionable Alerts */}
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" /> Requires Attention
              </CardTitle>
              <CardDescription>Items that need reordering immediately.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="space-y-4">
                {[
                  { name: 'Eco-friendly Water Bottle', sku: 'BOT-001', qty: 2, min: 10 },
                  { name: 'Organic Cotton T-Shirt', sku: 'TSH-042', qty: 0, min: 20 },
                  { name: 'Bamboo Toothbrush (Pack of 4)', sku: 'BAM-104', qty: 5, min: 15 },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-amber-600">{item.qty} left</p>
                      <p className="text-xs text-muted-foreground">Min: {item.min}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            <div className="p-4 pt-0 mt-auto">
              <Button variant="outline" className="w-full" asChild>
                <Link to="/op/inventory" search={{ filter: 'low_stock' }}>View all low stock</Link>
              </Button>
            </div>
          </Card>

          {/* Recent Activity */}
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileEdit className="h-5 w-5 text-muted-foreground" /> Recent Adjustments
              </CardTitle>
              <CardDescription>Stock corrections made in the last 48 hours.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="space-y-4">
                {[
                  { id: 'ADJ-1042', type: 'Damage', wh: 'Main WH', user: 'Admin', date: '2 hours ago' },
                  { id: 'ADJ-1041', type: 'Physical Count', wh: 'Retail Store', user: 'System', date: 'Yesterday' },
                  { id: 'ADJ-1040', type: 'Correction', wh: 'Main WH', user: 'Admin', date: 'Yesterday' },
                ].map((adj, i) => (
                  <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none flex items-center gap-2">
                        {adj.id}
                        <Badge variant="secondary" className="text-[10px]">{adj.type}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">{adj.wh} • by {adj.user}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {adj.date}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            <div className="p-4 pt-0 mt-auto">
              <Button variant="outline" className="w-full" asChild>
                <Link to="/op/inventory/adjustments">View all adjustments</Link>
              </Button>
            </div>
          </Card>
        </div>
      </Main>
    </>
  )
}
