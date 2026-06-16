import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { appUrl } from '@/lib/utils'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SafeImage } from '@/components/safe-image'
import { Loader2, Package, Search, ArrowLeft, ArrowUpDown } from 'lucide-react'

type SortField = 'name' | 'stock' | 'price' | 'updated'
type SortDir = 'asc' | 'desc'

interface Product {
  id: string
  name: string
  slug: string
  sku: string | null
  type: string
  stock: number
  manageStock: boolean
  lowStockQty: number | null
  basePrice: string
  salePrice: string | null
  images: string[] | null
  categoryId: string | null
  category: { id: string; name: string } | null
  variants: {
    id: string
    sku: string
    stock: number
    price: string | null
    attributeValues: { attributeValue: { value: string } }[]
  }[]
  _count: { orderItems: number }
}

interface StockOverviewResponse {
  data: Product[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export function StockOverview() {
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<SortField>('updated')
  const [sortOrder, setSortOrder] = useState<SortDir>('desc')

  const { data, isLoading } = useQuery<StockOverviewResponse>({
    queryKey: ['stock-overview', page, search, sortBy, sortOrder],
    queryFn: () =>
      apiClient
        .get('/inventory/stock-overview', {
          params: { page, perPage: 20, search, sortBy, sortOrder },
        })
        .then((r) => r.data),
  })

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder(field === 'name' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  const sortIndicator = (field: SortField) => {
    if (sortBy !== field) return <ArrowUpDown className='ml-1 h-3 w-3 inline opacity-30' />
    return <ArrowUpDown className={`ml-1 h-3 w-3 inline ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
  }

  const isLowStock = (p: Product) =>
    p.manageStock && p.stock <= (p.lowStockQty || 5)

  const meta = data?.meta
  const products = data?.data ?? []

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 me-auto'>
          <Button variant='ghost' size='icon' asChild className='shrink-0'>
            <a href='/op/inventory'><ArrowLeft className='h-4 w-4' /></a>
          </Button>
          <Search className='h-4 w-4 text-muted-foreground' />
          <Input
            placeholder='Search by name or SKU...'
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className='h-9 max-w-sm'
          />
          <Button variant='secondary' size='sm' onClick={handleSearch}>
            Search
          </Button>
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Stock Overview</h2>
            <p className='text-muted-foreground text-sm'>
              View and sort all products by stock levels.
            </p>
          </div>
          <Button variant='outline' asChild>
            <a href='/op/inventory'><ArrowLeft className='h-4 w-4 mr-1' /> Back to Inventory</a>
          </Button>
        </div>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base flex items-center gap-2'>
              <Package className='h-4 w-4' />
              All Products
              {meta && (
                <span className='text-sm font-normal text-muted-foreground'>
                  ({meta.total} items)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-12'></TableHead>
                  <TableHead className='cursor-pointer select-none' onClick={() => toggleSort('name')}>
                    Name / SKU {sortIndicator('name')}
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className='cursor-pointer select-none text-right' onClick={() => toggleSort('stock')}>
                    Stock {sortIndicator('stock')}
                  </TableHead>
                  <TableHead className='cursor-pointer select-none text-right' onClick={() => toggleSort('price')}>
                    Price {sortIndicator('price')}
                  </TableHead>
                  <TableHead>Variants</TableHead>
                  <TableHead className='text-right'>Orders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className='text-center py-8'>
                      <Loader2 className='animate-spin h-5 w-5 mx-auto' />
                    </TableCell>
                  </TableRow>
                ) : products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className='text-center py-8 text-muted-foreground text-sm'>
                      No products found
                    </TableCell>
                  </TableRow>
                ) : (
                  products.map((p) => {
                    const lowStock = isLowStock(p)
                    const img = Array.isArray(p.images) ? p.images[0] : null
                    const price = p.salePrice || p.basePrice
                    const variantAttrs = p.variants.map(
                      (v) =>
                        v.attributeValues
                          ?.map((av) => av.attributeValue?.value)
                          .filter(Boolean)
                          .join(' / ') || v.sku
                    )
                    return (
                      <TableRow
                        key={p.id}
                        className={lowStock ? 'bg-amber-50 dark:bg-amber-950/20' : ''}
                      >
                        <TableCell>
                          {img ? (
                            <SafeImage
                              src={appUrl(img)}
                              alt=''
                              className='w-9 h-9 rounded border object-cover'
                              thumbWidth={48}
                              thumbHeight={48}
                            />
                          ) : (
                            <div className='w-9 h-9 rounded border bg-muted flex items-center justify-center'>
                              <Package className='h-4 w-4 text-muted-foreground' />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className='font-medium text-sm'>{p.name}</div>
                          <div className='text-xs text-muted-foreground'>
                            {p.sku || '—'}
                            {lowStock && (
                              <Badge variant='outline' className='ml-2 text-[10px] border-amber-400 text-amber-700 dark:text-amber-400'>
                                Low Stock
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant='secondary' className='text-xs'>
                            {p.type}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-sm text-muted-foreground'>
                          {p.category?.name || '—'}
                        </TableCell>
                        <TableCell className='text-right'>
                          <Badge
                            variant={
                              !p.manageStock ? 'secondary' :
                              p.stock <= 0 ? 'destructive' :
                              lowStock ? 'outline' : 'default'
                            }
                            className={
                              !p.manageStock ? '' :
                              lowStock && p.stock > 0 ? 'border-amber-400 text-amber-700 dark:text-amber-400' : ''
                            }
                          >
                            {p.manageStock ? p.stock : '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-right font-medium text-sm'>
                          {price ? `৳${parseFloat(price).toLocaleString()}` : '—'}
                        </TableCell>
                        <TableCell>
                          {p.variants.length > 0 ? (
                            <div className='text-xs text-muted-foreground max-w-[200px] truncate' title={variantAttrs.join(', ')}>
                              {p.variants.length} variant{p.variants.length > 1 ? 's' : ''}
                              <span className='block truncate'>{variantAttrs.join(', ')}</span>
                            </div>
                          ) : (
                            <span className='text-xs text-muted-foreground'>—</span>
                          )}
                        </TableCell>
                        <TableCell className='text-right text-sm text-muted-foreground'>
                          {p._count.orderItems}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between text-sm text-muted-foreground'>
            <span>
              Page {meta.page} of {meta.totalPages} ({meta.total} total items)
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Main>
    </>
  )
}
