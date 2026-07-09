import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, Loader2, Warehouse, Eye, Plus } from 'lucide-react'
import { PhysicalAdjustDialog } from './components/physical-adjust-dialog'
import { InventoryDetailDrawer } from './components/inventory-detail-drawer'

interface PhysicalStock {
  id: string
  productId: string
  warehouseId: string
  quantity: number
  reservedQuantity: number
  updatedAt: string
  product: { id: string; name: string; sku: string; images: any }
  warehouse: { id: string; name: string; code: string }
}

export function PhysicalStockTable() {
  const [selectedWarehouse, setSelectedWarehouse] = useState('all')
  const [search, setSearch] = useState('')
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data),
  })

  const { data: stock, isLoading } = useQuery<PhysicalStock[]>({
    queryKey: ['physical-stock', selectedWarehouse],
    queryFn: () =>
      apiClient.get('/inventory/physical', {
        params: selectedWarehouse !== 'all' ? { warehouseId: selectedWarehouse } : {},
      }).then(r => r.data?.data || r.data || []),
  })

  const filteredStock = (stock || []).filter((s) =>
    !search || s.product.name.toLowerCase().includes(search.toLowerCase()) || s.product.sku.toLowerCase().includes(search.toLowerCase())
  )

  const availableQuantity = (s: PhysicalStock) => s.quantity - s.reservedQuantity

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2 me-auto'>
          <div className='relative'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
            <input
              className='h-9 w-64 rounded-md border border-input bg-background pl-9 pr-3 text-sm'
              placeholder='Search product or SKU...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
            <SelectTrigger className='w-[180px]'>
              <SelectValue placeholder='All Warehouses' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Warehouses</SelectItem>
              {(warehouses || []).map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>Physical Stock</h1>
            <p className='text-muted-foreground'>Warehouse-level inventory managed by physical counting.</p>
          </div>
          <Button onClick={() => setAdjustOpen(true)}>
            <Plus className='mr-2 h-4 w-4' /> Adjust Stock
          </Button>
        </div>

        <div className='rounded-md border bg-card'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className='text-right'>On Hand</TableHead>
                <TableHead className='text-right'>Reserved</TableHead>
                <TableHead className='text-right'>Available</TableHead>
                <TableHead className='text-right'>Last Updated</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className='text-center py-8'>
                    <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                  </TableCell>
                </TableRow>
              ) : filteredStock.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className='text-center py-12 text-muted-foreground'>
                    <Warehouse className='h-8 w-8 mx-auto mb-2 opacity-40' />
                    No physical stock records found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredStock.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className='font-medium'>{s.product.name}</TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{s.product.sku}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>{s.warehouse.name}</Badge>
                    </TableCell>
                    <TableCell className='text-right'>{s.quantity}</TableCell>
                    <TableCell className='text-right'>{s.reservedQuantity}</TableCell>
                    <TableCell className='text-right'>
                      <span className={availableQuantity(s) <= 0 ? 'text-destructive font-medium' : 'text-green-600 font-medium'}>
                        {availableQuantity(s)}
                      </span>
                    </TableCell>
                    <TableCell className='text-right text-sm text-muted-foreground'>
                      {new Date(s.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button variant='ghost' size='sm' onClick={() => setSelectedProductId(s.productId)}>
                        <Eye className='h-4 w-4' />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Main>

      <PhysicalAdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} />
      {selectedProductId && (
        <InventoryDetailDrawer
          productId={selectedProductId}
          open={!!selectedProductId}
          onClose={() => setSelectedProductId(null)}
        />
      )}
    </>
  )
}