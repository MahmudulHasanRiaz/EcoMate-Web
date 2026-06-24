import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, ArrowLeft, Search, DollarSign, Package, Hash } from 'lucide-react'

interface ValuationItem {
  id: string
  sku: string | null
  name: string
  type: 'product' | 'variant'
  stock: number
  unitPrice: number
  totalValue: number
}

interface ValuationResponse {
  items: ValuationItem[]
  totalValue: number
  totalStock: number
  count: number
}

const valuationApi = {
  fetch: (params?: { categoryId?: string; search?: string }) =>
    apiClient.get('/inventory/valuation', { params }).then((r) => r.data as ValuationResponse),
}

export function InventoryValuation() {
  const [categorySearch, setCategorySearch] = useState('')
  const [textSearch, setTextSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-valuation', categoryId, textSearch],
    queryFn: () => valuationApi.fetch({ categoryId, search: textSearch || undefined }),
  })

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 me-auto'>
          <Button variant='ghost' size='icon' asChild className='shrink-0'>
            <a href='/op/inventory'><ArrowLeft className='h-4 w-4' /></a>
          </Button>
          <GlobalSearchBar className='me-auto' />
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Inventory Valuation</h2>
            <p className='text-muted-foreground text-sm'>
              Current stock value by item.
            </p>
          </div>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-sm font-medium text-muted-foreground'>Total Value</CardTitle>
              <DollarSign className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Loader2 className='animate-spin h-5 w-5' />
              ) : (
                <div className='text-2xl font-bold'>
                  ৳{(data?.totalValue ?? 0).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-sm font-medium text-muted-foreground'>Total Stock Units</CardTitle>
              <Package className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Loader2 className='animate-spin h-5 w-5' />
              ) : (
                <div className='text-2xl font-bold'>
                  {(data?.totalStock ?? 0).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex flex-row items-center justify-between pb-2'>
              <CardTitle className='text-sm font-medium text-muted-foreground'>Product Count</CardTitle>
              <Hash className='h-4 w-4 text-muted-foreground' />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Loader2 className='animate-spin h-5 w-5' />
              ) : (
                <div className='text-2xl font-bold'>
                  {(data?.count ?? 0).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className='pb-2'>
            <div className='flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between'>
              <CardTitle className='text-base flex items-center gap-2'>
                <Package className='h-4 w-4' />
                Items
              </CardTitle>
              <div className='flex gap-2 w-full sm:w-auto'>
                <div className='relative flex-1 sm:w-48'>
                  <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                  <Input
                    placeholder='Filter by category...'
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setCategoryId(categorySearch || undefined)
                    }}
                    className='pl-8 h-9'
                  />
                </div>
                <div className='relative flex-1 sm:w-56'>
                  <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                  <Input
                    placeholder='Search by name or SKU...'
                    value={textSearch}
                    onChange={(e) => setTextSearch(e.target.value)}
                    className='pl-8 h-9'
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU / Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className='text-right'>Stock Qty</TableHead>
                  <TableHead className='text-right'>Unit Price</TableHead>
                  <TableHead className='text-right'>Total Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className='text-center py-8'>
                      <Loader2 className='animate-spin h-5 w-5 mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : !data?.items?.length ? (
                  <TableRow>
                    <TableCell colSpan={5} className='text-center py-8 text-muted-foreground text-sm'>
                      No items found
                    </TableCell>
                  </TableRow>
                ) : (
                  data.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className='font-medium text-sm'>{item.name}</div>
                        <div className='text-xs text-muted-foreground'>{item.sku || '—'}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant='secondary' className='text-xs'>
                          {item.type}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right font-medium'>
                        {item.stock.toLocaleString()}
                      </TableCell>
                      <TableCell className='text-right'>
                        ৳{item.unitPrice.toLocaleString()}
                      </TableCell>
                      <TableCell className='text-right font-medium'>
                        ৳{item.totalValue.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
