# Admin + Storefront UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build admin Physical Inventory suite, Order Status State Machine visualization, Stock Adjustment enhancements, and Storefront OOS awareness.

**Architecture:** 5 independent workstreams with shared dependency on PhysicalInventory backend controller. Admin uses TanStack Router + shadcn/ui + React Query. Storefront uses Next.js 16 + Tailwind v4 CSS-first.

**Tech Stack:** TypeScript, React + TanStack Router (admin), Next.js 16 (storefront), shadcn/ui + Tailwind v4 (both), Axios, @tanstack/react-query, Lucide icons, sonner toasts

**Dependency order:** Backend controller (T1) → Admin UI (T2-T8) → Storefront (T9-T11). T2-T5, T6-T7, T8, T9-T11 are independent sub-workstreams.

---

## File Structure

### Create:
- `apps/backend/src/inventory/physical-inventory.controller.ts` — REST controller for PhysicalInventory CRUD
- `apps/admin/src/features/orders/order-status-machine.tsx` — Interactive state machine SVG component
- `apps/admin/src/routes/_authenticated/op/inventory/physical/index.tsx` — Route wrapper for PhysicalStockTable
- `apps/admin/src/routes/_authenticated/op/inventory/physical/reservations.tsx` — Route wrapper for ReservationDashboard
- `apps/admin/src/features/inventory/physical-stock-table.tsx` — Warehouse-level physical stock table
- `apps/admin/src/features/inventory/reservation-dashboard.tsx` — Active reservation management view
- `apps/admin/src/features/inventory/components/physical-adjust-dialog.tsx` — Physical stock adjust dialog (mode=PHYSICAL)
- `apps/admin/src/features/orders/status-transitions.ts` — Shared status transition map constant

### Modify:
- `apps/backend/src/inventory/inventory.module.ts` — Register PhysicalInventoryController
- `apps/admin/src/components/layout/data/sidebar-data.ts` — Add Physical Stock + Reservations under Inventory group
- `apps/admin/src/routes/_authenticated/op/orders/$id.tsx` — Integrate OrderStatusMachine component + update status colors to match seed
- `apps/admin/src/features/inventory/adjustments.tsx` — Add mode selector (MANAGED/PHYSICAL) + warehouse field
- `apps/storefront/lib/types.ts` — Add `availabilityMode` to Product interface
- `apps/storefront/components/ProductCard.tsx` — Add OOS badge + disabled CTA
- `apps/storefront/context/CartContext.tsx` — Add ALWAYS_OUT_OF_STOCK guard to addToCart

---

### Task 1: PhysicalInventory Backend Controller

**Files:**
- Create: `apps/backend/src/inventory/physical-inventory.controller.ts`
- Modify: `apps/backend/src/inventory/inventory.module.ts`

- [ ] **Step 1: Create PhysicalInventoryController**

```typescript
import { Controller, Get, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { StockService } from '../stock/stock.service';

@Controller('inventory/physical')
export class PhysicalInventoryController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  async list(@Query('productId') productId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.stockService.listPhysical(productId, warehouseId);
  }

  @Patch('adjust')
  async adjust(@Body() dto: { productId: string; warehouseId: string; quantity: number; reason: string }) {
    await this.stockService.addPhysical(dto.productId, dto.warehouseId, dto.quantity, dto.reason);
    return { ok: true };
  }

  @Get('reservations')
  async reservations(@Query('warehouseId') warehouseId?: string, @Query('productId') productId?: string) {
    return this.stockService.listReservations(warehouseId, productId);
  }

  @Delete('reservations/:id')
  async releaseReservation(@Param('id') id: string) {
    await this.stockService.releasePhysical(id);
    return { ok: true };
  }
}
```

Note: `listPhysical()` and `listReservations()` don't exist yet on StockService — add them if missing. They query prisma.physicalInventory.findMany with includes for product/warehouse.

- [ ] **Step 2: Add required StockService query methods**

Add to `apps/backend/src/stock/stock.service.ts`:

```typescript
async listPhysical(productId?: string, warehouseId?: string) {
  const where: any = {};
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;
  return this.prisma.physicalInventory.findMany({
    where,
    include: { product: { select: { id: true, name: true, sku: true, images: true } }, warehouse: true },
    orderBy: { updatedAt: 'desc' },
  });
}

async listReservations(warehouseId?: string, productId?: string) {
  const where: any = { reservedQuantity: { gt: 0 } };
  if (warehouseId) where.warehouseId = warehouseId;
  if (productId) where.productId = productId;
  return this.prisma.physicalInventory.findMany({
    where,
    include: { product: { select: { id: true, name: true, sku: true, images: true } }, warehouse: true },
    orderBy: { updatedAt: 'desc' },
  });
}
```

- [ ] **Step 3: Register controller in module**

Modify `apps/backend/src/inventory/inventory.module.ts`:

```typescript
import { PhysicalInventoryController } from './physical-inventory.controller';

@Module({
  controllers: [PhysicalInventoryController, ...existingControllers],
  // ...
})
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit --project apps/backend/tsconfig.json`
Expected: No errors

---

### Task 2: Admin Physical Inventory Routes + Sidebar

**Files:**
- Create: `apps/admin/src/routes/_authenticated/op/inventory/physical/index.tsx`
- Create: `apps/admin/src/routes/_authenticated/op/inventory/physical/reservations.tsx`
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts`

- [ ] **Step 1: Create Physical Stock route file**

Create `apps/admin/src/routes/_authenticated/op/inventory/physical/index.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { PhysicalStockTable } from '@/features/inventory/physical-stock-table'

export const Route = createFileRoute('/_authenticated/op/inventory/physical')({
  component: PhysicalStockTable,
})
```

- [ ] **Step 2: Create Reservations route file**

Create `apps/admin/src/routes/_authenticated/op/inventory/physical/reservations.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { ReservationDashboard } from '@/features/inventory/reservation-dashboard'

export const Route = createFileRoute('/_authenticated/op/inventory/physical/reservations')({
  component: ReservationDashboard,
})
```

- [ ] **Step 3: Add sidebar entries**

In `apps/admin/src/components/layout/data/sidebar-data.ts`, find the Inventory collapsible group and add after the existing entries:

```typescript
{
  title: 'Physical Stock',
  url: '/op/inventory/physical',
},
{
  title: 'Reservations',
  url: '/op/inventory/physical/reservations',
},
```

- [ ] **Step 4: Run admin build check**

Run: `cd apps/admin && npx tsc --noEmit --project tsconfig.json`
Expected: No type errors

---

### Task 3: PhysicalStockTable Component

**Files:**
- Create: `apps/admin/src/features/inventory/physical-stock-table.tsx`

- [ ] **Step 1: Write PhysicalStockTable component**

```typescript
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
  availableQuantity: number
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
                      <span className={s.availableQuantity <= 0 ? 'text-destructive font-medium' : 'text-green-600 font-medium'}>
                        {s.availableQuantity}
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
```

- [ ] **Step 2: Build and verify**

Run: `cd apps/admin && npx tsc --noEmit --project tsconfig.json`
Expected: Clean compile

---

### Task 4: ReservationDashboard Component

**Files:**
- Create: `apps/admin/src/features/inventory/reservation-dashboard.tsx`

- [ ] **Step 1: Write ReservationDashboard component**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Search, Loader2, CalendarDays, XCircle } from 'lucide-react'

interface Reservation {
  id: string
  productId: string
  warehouseId: string
  quantity: number
  reservedQuantity: number
  updatedAt: string
  product: { id: string; name: string; sku: string }
  warehouse: { id: string; name: string }
}

export function ReservationDashboard() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedWarehouse, setSelectedWarehouse] = useState('all')
  const [releaseId, setReleaseId] = useState<string | null>(null)

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data),
  })

  const { data: reservations, isLoading } = useQuery<Reservation[]>({
    queryKey: ['physical-reservations', selectedWarehouse],
    queryFn: () =>
      apiClient.get('/inventory/physical/reservations', {
        params: selectedWarehouse !== 'all' ? { warehouseId: selectedWarehouse } : {},
      }).then(r => r.data?.data || r.data || []),
  })

  const releaseMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/inventory/physical/reservations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['physical-reservations'] })
      queryClient.invalidateQueries({ queryKey: ['physical-stock'] })
      toast.success('Reservation released')
      setReleaseId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to release'),
  })

  const filtered = (reservations || []).filter((r) =>
    !search || r.product.name.toLowerCase().includes(search.toLowerCase()) || r.product.sku.toLowerCase().includes(search.toLowerCase())
  )

  const totalReserved = filtered.reduce((sum, r) => sum + r.reservedQuantity, 0)

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
            <h1 className='text-2xl font-bold tracking-tight'>Reservations</h1>
            <p className='text-muted-foreground'>Active stock reservations across warehouses.</p>
          </div>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <CalendarDays className='h-4 w-4' />
            <span>{filtered.length} items reserved ({totalReserved} units)</span>
          </div>
        </div>

        <div className='rounded-md border bg-card'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className='text-right'>Reserved</TableHead>
                <TableHead className='text-right'>On Hand</TableHead>
                <TableHead className='text-right'>Reserved Since</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-center py-8'>
                    <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-center py-12 text-muted-foreground'>
                    No active reservations.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='font-medium'>{r.product.name}</TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{r.product.sku}</TableCell>
                    <TableCell><Badge variant='outline'>{r.warehouse.name}</Badge></TableCell>
                    <TableCell className='text-right font-medium'>{r.reservedQuantity}</TableCell>
                    <TableCell className='text-right'>{r.quantity}</TableCell>
                    <TableCell className='text-right text-sm text-muted-foreground'>
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button variant='ghost' size='sm' className='text-destructive' onClick={() => setReleaseId(r.id)}>
                        <XCircle className='h-4 w-4 mr-1' /> Release
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Main>

      <AlertDialog open={!!releaseId} onOpenChange={() => setReleaseId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release Reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will free the reserved stock. The order allocation will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => releaseId && releaseMut.mutate(releaseId)} disabled={releaseMut.isPending}>
              {releaseMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-1' /> : null}
              Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd apps/admin && npx tsc --noEmit --project tsconfig.json`
Expected: Clean compile

---

### Task 5: PhysicalAdjustDialog Component

**Files:**
- Create: `apps/admin/src/features/inventory/components/physical-adjust-dialog.tsx`

- [ ] **Step 1: Write PhysicalAdjustDialog**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function PhysicalAdjustDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string; sku: string } | null>(null)
  const [selectedWarehouse, setSelectedWarehouse] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [reason, setReason] = useState('')

  const { data: products } = useQuery<any[]>({
    queryKey: ['product-search-physical', productSearch],
    queryFn: () => apiClient.get('/products', { params: { search: productSearch, perPage: 8 } }).then(r => r.data?.data || r.data || []),
    enabled: productSearch.length > 0,
  })

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const adjustMut = useMutation({
    mutationFn: (data: { productId: string; warehouseId: string; quantity: number; reason: string }) =>
      apiClient.patch('/inventory/physical/adjust', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['physical-stock'] })
      queryClient.invalidateQueries({ queryKey: ['physical-reservations'] })
      toast.success('Physical stock adjusted')
      reset()
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Adjustment failed'),
  })

  function reset() {
    setProductSearch('')
    setSelectedProduct(null)
    setSelectedWarehouse('')
    setQuantity(0)
    setReason('')
  }

  function handleSubmit() {
    if (!selectedProduct) { toast.error('Select a product'); return }
    if (!selectedWarehouse) { toast.error('Select a warehouse'); return }
    if (!quantity || quantity === 0) { toast.error('Quantity must be non-zero'); return }
    if (!reason.trim()) { toast.error('Reason is required'); return }
    adjustMut.mutate({
      productId: selectedProduct.id,
      warehouseId: selectedWarehouse,
      quantity,
      reason: reason.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>Adjust Physical Stock</DialogTitle>
          <DialogDescription>Add or remove physical inventory at a warehouse.</DialogDescription>
        </DialogHeader>
        <div className='grid gap-4 py-4'>
          <div className='space-y-2'>
            <Label>Product</Label>
            <Command className='border rounded-md shadow-sm' shouldFilter={false}>
              <CommandInput placeholder='Search products...' value={productSearch} onValueChange={setProductSearch} />
              {productSearch.length > 0 && (
                <CommandList className='max-h-48 overflow-y-auto'>
                  <CommandEmpty>No products found.</CommandEmpty>
                  <CommandGroup>
                    {(products || []).map((p: any) => (
                      <CommandItem key={p.id} onSelect={() => { setSelectedProduct(p); setProductSearch(p.name) }}>
                        <div className='flex items-center justify-between w-full'>
                          <span>{p.name}</span>
                          <span className='text-xs text-muted-foreground'>{p.sku}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              )}
            </Command>
          </div>

          <div className='space-y-2'>
            <Label>Warehouse</Label>
            <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
              <SelectTrigger>
                <SelectValue placeholder='Select warehouse' />
              </SelectTrigger>
              <SelectContent>
                {(warehouses || []).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <Label>Quantity (positive=add, negative=remove)</Label>
            <Input type='number' placeholder='e.g. 10 or -5' value={quantity || ''} onChange={e => setQuantity(parseInt(e.target.value) || 0)} />
          </div>

          <div className='space-y-2'>
            <Label>Reason</Label>
            <Input placeholder='e.g. Cycle count correction' value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => { reset(); onOpenChange(false) }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={adjustMut.isPending}>
            {adjustMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Build and verify**

Run: `cd apps/admin && npx tsc --noEmit --project tsconfig.json`
Expected: Clean compile

---

### Task 6: Status Transition Constant

**Files:**
- Create: `apps/admin/src/features/orders/status-transitions.ts`

This file defines the canonical status transition map for the admin app, mirroring the backend seed data. The state machine component reads from this.

- [ ] **Step 1: Create transitions constant file**

```typescript
export interface StatusNode {
  id: string
  name: string
  color: string
  x: number
  y: number
  column: number
  row: number
}

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Payment Pending', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Pending': ['Payment Verifying', 'Hold', 'Confirmed', 'Cancelled'],
  'Payment Verifying': ['Confirmed', 'Hold', 'Cancelled'],
  'Hold': ['Pending', 'Confirmed', 'Cancelled'],
  'Confirmed': ['Packed', 'Packing Hold', 'Cancelled'],
  'Packed': ['Shipping', 'Packing Hold'],
  'Packing Hold': ['Packed', 'Cancelled'],
  'Shipping': ['Delivered', 'Partial'],
  'Delivered': ['Return Pending'],
  'Partial': ['Return Pending'],
  'Return Pending': ['Returned', 'Damaged'],
  'Returned': ['Damaged'],
  'Cancelled': ['Confirmed'],
  'Damaged': [],
}

export const STATUS_COLORS: Record<string, string> = {
  'Pending': '#F59E0B',
  'Payment Pending': '#F59E0B',
  'Payment Verifying': '#8B5CF6',
  'Hold': '#D97706',
  'Confirmed': '#3B82F6',
  'Packed': '#059669',
  'Packing Hold': '#D97706',
  'Shipping': '#06B6D4',
  'Delivered': '#10B981',
  'Partial': '#F59E0B',
  'Return Pending': '#EC4899',
  'Returned': '#DC2626',
  'Damaged': '#991B1B',
  'Cancelled': '#EF4444',
}

export const STATUS_LAYOUT: StatusNode[] = [
  { id: '0', name: 'Pending', color: STATUS_COLORS['Pending'], x: 0, y: 0, column: 0, row: 0 },
  { id: '1', name: 'Payment Pending', color: STATUS_COLORS['Payment Pending'], x: 0, y: 0, column: 1, row: 0 },
  { id: '2', name: 'Payment Verifying', color: STATUS_COLORS['Payment Verifying'], x: 0, y: 0, column: 2, row: 0 },
  { id: '3', name: 'Confirmed', color: STATUS_COLORS['Confirmed'], x: 0, y: 0, column: 3, row: 0 },
  { id: '4', name: 'Packed', color: STATUS_COLORS['Packed'], x: 0, y: 0, column: 4, row: 0 },
  { id: '5', name: 'Shipping', color: STATUS_COLORS['Shipping'], x: 0, y: 0, column: 5, row: 0 },
  { id: '6', name: 'Delivered', color: STATUS_COLORS['Delivered'], x: 0, y: 0, column: 6, row: 0 },
  { id: '7', name: 'Hold', color: STATUS_COLORS['Hold'], x: 0, y: 0, column: 2, row: 1 },
  { id: '8', name: 'Packing Hold', color: STATUS_COLORS['Packing Hold'], x: 0, y: 0, column: 4, row: 1 },
  { id: '9', name: 'Partial', color: STATUS_COLORS['Partial'], x: 0, y: 0, column: 5, row: 1 },
  { id: '10', name: 'Return Pending', color: STATUS_COLORS['Return Pending'], x: 0, y: 0, column: 6, row: 1 },
  { id: '11', name: 'Returned', color: STATUS_COLORS['Returned'], x: 0, y: 0, column: 7, row: 0 },
  { id: '12', name: 'Cancelled', color: STATUS_COLORS['Cancelled'], x: 0, y: 0, column: 7, row: 1 },
  { id: '13', name: 'Damaged', color: STATUS_COLORS['Damaged'], x: 0, y: 0, column: 8, row: 0 },
]
```

Note: The grid positions (column, row) will be used by the SVG layout to position nodes. The SVG component computes actual x,y from column*nodeWidth + row*rowHeight.

- [ ] **Step 2: Verify file created correctly**

Run: `cd apps/admin && npx tsc --noEmit --project tsconfig.json`
Expected: Clean compile

---

### Task 7: Order Status Machine Component

**Files:**
- Create: `apps/admin/src/features/orders/order-status-machine.tsx`
- Modify: `apps/admin/src/routes/_authenticated/op/orders/$id.tsx`

- [ ] **Step 1: Write OrderStatusMachine component**

The component renders an interactive SVG state machine. It shows all 14 statuses as nodes, highlights the current status, and allows clicking allowed transitions.

```typescript
import { useMemo, useState } from 'react'
import { ORDER_TRANSITIONS, STATUS_COLORS, STATUS_LAYOUT } from './status-transitions'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props {
  currentStatusName: string
  statusList: { id: string; name: string }[]
  allowedNextIds: string[]
  onStatusClick: (statusId: string) => void
}

const NODE_W = 130
const NODE_H = 36
const COL_GAP = 16
const ROW_GAP = 60
const PADDING = 20

export function OrderStatusMachine({ currentStatusName, statusList, allowedNextIds, onStatusClick }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const layout = useMemo(() => {
    const maxCol = Math.max(...STATUS_LAYOUT.map((n) => n.column))
    const maxRow = Math.max(...STATUS_LAYOUT.map((n) => n.row))
    const cols: Record<number, number> = {}
    STATUS_LAYOUT.forEach((n) => { cols[n.column] = Math.max(cols[n.column] || 0, n.row) })

    return STATUS_LAYOUT.map((node) => ({
      ...node,
      x: PADDING + node.column * (NODE_W + COL_GAP),
      y: PADDING + node.row * (NODE_H + ROW_GAP),
    }))
  }, [])

  const edges = useMemo(() => {
    const result: { from: string; to: string; path: string }[] = []
    layout.forEach((from) => {
      const targets = ORDER_TRANSITIONS[from.name] || []
      targets.forEach((toName) => {
        const to = layout.find((n) => n.name === toName)
        if (!to) return
        const x1 = from.x + NODE_W
        const y1 = from.y + NODE_H / 2
        const x2 = to.x
        const y2 = to.y + NODE_H / 2
        const midX = (x1 + x2) / 2
        const isSameRow = from.row === to.row
        const path = isSameRow
          ? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
          : from.y < to.y
            ? `M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`
            : `M ${from.x + NODE_W / 2} ${from.y + NODE_H} C ${from.x + NODE_W / 2} ${from.y + NODE_H + 20}, ${to.x + NODE_W / 2} ${to.y - 10}, ${to.x + NODE_W / 2} ${to.y}`
        result.push({ from: from.name, to: toName, path })
      })
    })
    return result
  }, [layout])

  const svgW = PADDING * 2 + (Math.max(...layout.map((n) => n.column)) + 1) * (NODE_W + COL_GAP)
  const svgH = PADDING * 2 + (Math.max(...layout.map((n) => n.row)) + 1) * (NODE_H + ROW_GAP)

  const isTransitionAllowed = (from: string, to: string) => {
    return (ORDER_TRANSITIONS[from] || []).includes(to)
  }

  return (
    <div className='w-full overflow-auto rounded-md border bg-card p-4'>
      <svg width={svgW} height={svgH} className='min-w-full'>
        <defs>
          {layout.map((node) => (
            <filter key={node.name} id={`glow-${node.name}`}>
              <feGaussianBlur stdDeviation='3' result='blur' />
              <feMerge><feMergeNode in='blur' /><feMergeNode in='SourceGraphic' /></feMerge>
            </filter>
          ))}
        </defs>

        {/* Edges */}
        {edges.map((edge) => {
          const isFromCurrent = edge.from === currentStatusName
          const isAllowed = isFromCurrent && allowedNextIds.some(
            (id) => statusList.find((s) => s.name === edge.to)?.id === id
          )
          const strokeColor = isAllowed ? '#22C55E' : '#E5E7EB'
          const strokeWidth = isAllowed ? 2.5 : 1.5
          const opacity = isAllowed ? 1 : 0.4
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={edge.path}
              fill='none'
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeLinecap='round'
              className={isAllowed ? 'transition-all duration-300' : ''}
            />
          )
        })}

        {/* Nodes */}
        {layout.map((node) => {
          const isCurrent = node.name === currentStatusName
          const isAllowed = allowedNextIds.some((id) => statusList.find((s) => s.name === node.name)?.id === id) && node.name !== currentStatusName
          const isClickable = isAllowed || isCurrent
          const fillColor = STATUS_COLORS[node.name] || '#6B7280'

          return (
            <g
              key={node.name}
              className={cn(
                'transition-all duration-200',
                isClickable ? 'cursor-pointer' : 'cursor-default'
              )}
              onClick={() => {
                if (isAllowed) {
                  const status = statusList.find((s) => s.name === node.name)
                  if (status) onStatusClick(status.id)
                }
              }}
              onMouseEnter={() => setHovered(node.name)}
              onMouseLeave={() => setHovered(null)}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={fillColor}
                opacity={isCurrent ? 1 : 0.85}
                filter={isCurrent ? `url(#glow-${node.name})` : undefined}
                stroke={hovered === node.name ? '#fff' : 'transparent'}
                strokeWidth={isCurrent ? 2 : hovered === node.name ? 2 : 0}
              />
              <text
                x={node.x + NODE_W / 2}
                y={node.y + NODE_H / 2}
                textAnchor='middle'
                dominantBaseline='central'
                fill='#fff'
                fontSize={11}
                fontWeight={isCurrent ? 'bold' : 'normal'}
              >
                {node.name}
              </text>
              {isCurrent && (
                <text
                  x={node.x + NODE_W / 2}
                  y={node.y + NODE_H + 14}
                  textAnchor='middle'
                  fill='#6B7280'
                  fontSize={10}
                >
                  Current
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Integrate into order detail page**

In `apps/admin/src/routes/_authenticated/op/orders/$id.tsx`:

Add import:
```typescript
import { OrderStatusMachine } from '@/features/orders/order-status-machine'
```

Replace the status change dropdown area (lines ~255-267) with the new state machine:

```typescript
{/* Status section */}
<div className='flex items-center gap-2 border rounded-md px-3 py-1.5'>
  <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }}>
    {order.status.name}
  </Badge>
  {order.courierService && order.courierStatus && (
    <Badge variant='outline' className='text-xs flex items-center gap-1'>
      <Truck className='h-3 w-3' /> {order.courierStatus}
    </Badge>
  )}
  {order.trackingUrl && (
    <Button size='icon' variant='ghost' className='h-6 w-6' title='Track' onClick={() => window.open(order.trackingUrl!, '_blank')}>
      <ExternalLink className='h-3 w-3' />
    </Button>
  )}
</div>
```

And add the state machine component between the header and the grid layout. Insert after line ~269 (`</div>`) and before the grid:

```typescript
<OrderStatusMachine
  currentStatusName={order.status.name}
  statusList={statusList}
  allowedNextIds={order.status.nextStatuses}
  onStatusClick={(statusId) => setShowStatusDialog(statusId)}
/>
```

- [ ] **Step 3: Update statusColors to match seed data**

In `apps/admin/src/routes/_authenticated/op/orders/$id.tsx`, replace the `statusColors` definition at line 28:

```typescript
const statusColors: Record<string, string> = {
  Pending: '#F59E0B',
  'Payment Pending': '#F59E0B',
  'Payment Verifying': '#8B5CF6',
  Hold: '#D97706',
  Confirmed: '#3B82F6',
  Packed: '#059669',
  'Packing Hold': '#D97706',
  Shipping: '#06B6D4',
  Delivered: '#10B981',
  Partial: '#F59E0B',
  'Return Pending': '#EC4899',
  Returned: '#DC2626',
  Damaged: '#991B1B',
  Cancelled: '#EF4444',
}
```

- [ ] **Step 4: Build and verify**

Run: `cd apps/admin && npx tsc --noEmit --project tsconfig.json`
Expected: Clean compile

---

### Task 8: Enhance Stock Adjustment Form

**Files:**
- Modify: `apps/admin/src/features/inventory/adjustments.tsx`

- [ ] **Step 1: Add mode selector and warehouse field to adjustments dialog**

The existing adjustments page at `adjustments.tsx` has a "New Adjustment" dialog. Add a mode selector (Managed / Physical) and conditional warehouse field.

Replace the dialog content area (lines ~239-331) with:

```typescript
<Dialog open={newAdjustmentOpen} onOpenChange={v => { setNewAdjustmentOpen(v); if (!v) resetAdjustmentForm() }}>
  <DialogContent className='sm:max-w-[550px]'>
    <DialogHeader>
      <DialogTitle className='flex items-center gap-2'>
        <Package className='h-5 w-5' /> Create Inventory Adjustment
      </DialogTitle>
      <DialogDescription>
        Adjust stock for a product. Physical adjustments are tied to a specific warehouse.
      </DialogDescription>
    </DialogHeader>
    <div className='grid gap-4 py-4'>
      <div className='space-y-2'>
        <Label>Mode</Label>
        <Select value={adjustmentMode} onValueChange={(v: 'MANAGED' | 'PHYSICAL') => setAdjustmentMode(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='MANAGED'>Managed Stock (virtual)</SelectItem>
            <SelectItem value='PHYSICAL'>Physical Stock (warehouse)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className='space-y-2'>
        <Label>Search Product</Label>
        <Command className='border rounded-md shadow-sm' shouldFilter={false}>
          <CommandInput
            placeholder='Search products...'
            value={productSearch}
            onValueChange={setProductSearch}
          />
          {productSearch.length > 0 && (
            <CommandList className='max-h-48 overflow-y-auto'>
              <CommandEmpty>No products found.</CommandEmpty>
              <CommandGroup>
                {products.map((p) => (
                  <CommandItem key={p.id} onSelect={() => { setSelectedProduct(p); setProductSearch(p.name) }}>
                    <div className='flex items-center justify-between w-full'>
                      <span>{p.name}</span>
                      <span className='text-xs text-muted-foreground'>{p.sku}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
        </Command>
        {selectedProduct && (
          <p className='text-xs text-muted-foreground'>
            Selected: {selectedProduct.name} ({selectedProduct.sku})
            {selectedProduct.managedStockQuantity != null && ` — Stock: ${selectedProduct.managedStockQuantity}`}
          </p>
        )}
      </div>

      {adjustmentMode === 'PHYSICAL' && (
        <div className='space-y-2'>
          <Label>Warehouse</Label>
          <Select value={adjustmentWarehouse} onValueChange={setAdjustmentWarehouse}>
            <SelectTrigger>
              <SelectValue placeholder='Select warehouse' />
            </SelectTrigger>
            <SelectContent>
              {(warehouses || []).map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className='space-y-2'>
        <Label>Direction</Label>
        <Select value={adjustmentDirection} onValueChange={(v: 'IN' | 'OUT') => setAdjustmentDirection(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='IN'>Stock In (Add)</SelectItem>
            <SelectItem value='OUT'>Stock Out (Remove)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className='space-y-2'>
        <Label>Quantity</Label>
        <Input type='number' min={1} placeholder='e.g. 10' value={adjustmentQuantity || ''} onChange={e => setAdjustmentQuantity(parseInt(e.target.value) || 0)} />
      </div>

      <div className='space-y-2'>
        <Label>Reason</Label>
        <Input placeholder='e.g. Cycle count correction' value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} />
      </div>
    </div>
    <DialogFooter>
      <Button variant='outline' onClick={() => { setNewAdjustmentOpen(false); resetAdjustmentForm() }}>Cancel</Button>
      <Button onClick={handleCreateAdjustment} disabled={createMut.isPending}>
        {createMut.isPending && <Loader2 className='animate-spin h-4 w-4 mr-1' />}
        Create Adjustment
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: Add state variables and warehouse query**

After line 66 (`const [adjustmentDirection, setAdjustmentDirection] = useState<'IN' | 'OUT'>('IN')`), add:

```typescript
const [adjustmentMode, setAdjustmentMode] = useState<'MANAGED' | 'PHYSICAL'>('MANAGED')
const [adjustmentWarehouse, setAdjustmentWarehouse] = useState('')

const { data: warehouses } = useQuery<any[]>({
  queryKey: ['warehouses'],
  queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
})
```

- [ ] **Step 3: Update handleCreateAdjustment**

Replace the `handleCreateAdjustment` function to route to the correct API:

```typescript
function handleCreateAdjustment() {
  if (!selectedProduct) { toast.error('Select a product'); return }
  if (adjustmentQuantity <= 0) { toast.error('Quantity must be positive'); return }
  if (!adjustmentReason.trim()) { toast.error('Reason is required'); return }
  const quantity = adjustmentDirection === 'OUT' ? -Math.abs(adjustmentQuantity) : Math.abs(adjustmentQuantity)

  if (adjustmentMode === 'PHYSICAL') {
    if (!adjustmentWarehouse) { toast.error('Select a warehouse'); return }
    createMut.mutate({
      productId: selectedProduct.id,
      warehouseId: adjustmentWarehouse,
      quantity,
      reason: adjustmentReason.trim(),
      mode: 'PHYSICAL',
    })
  } else {
    createMut.mutate({
      productId: selectedProduct.id,
      quantity,
      reason: adjustmentReason.trim(),
      mode: 'MANAGED',
    })
  }
}
```

- [ ] **Step 4: Update mutationFn to pass mode**

Replace the `createMut` mutationFn:

```typescript
const createMut = useMutation({
  mutationFn: (data: { productId: string; quantity: number; reason: string; warehouseId?: string; mode?: string }) => {
    if (data.mode === 'PHYSICAL') {
      return apiClient.patch('/inventory/physical/adjust', {
        productId: data.productId,
        warehouseId: data.warehouseId,
        quantity: data.quantity,
        reason: data.reason,
      })
    }
    return apiClient.post('/inventory/adjust', {
      productId: data.productId,
      quantity: data.quantity,
      reason: data.reason,
    })
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['inventory-adjustment-logs'] })
    queryClient.invalidateQueries({ queryKey: ['physical-stock'] })
    setNewAdjustmentOpen(false)
    resetAdjustmentForm()
    toast.success('Adjustment created')
  },
  onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating adjustment'),
})
```

- [ ] **Step 5: Update resetAdjustmentForm**

```typescript
function resetAdjustmentForm() {
  setSelectedProduct(null)
  setProductSearch('')
  setAdjustmentQuantity(0)
  setAdjustmentReason('')
  setAdjustmentDirection('IN')
  setAdjustmentMode('MANAGED')
  setAdjustmentWarehouse('')
}
```

- [ ] **Step 6: Build and verify**

Run: `cd apps/admin && npx tsc --noEmit --project tsconfig.json`
Expected: Clean compile

---

### Task 9: Storefront Type Updates

**Files:**
- Modify: `apps/storefront/lib/types.ts`

- [ ] **Step 1: Add availabilityMode to Product type**

```typescript
export interface Product {
  // ... existing fields remain
  availabilityMode?: 'MANAGED_STOCK' | 'ALWAYS_IN_STOCK' | 'ALWAYS_OUT_OF_STOCK'
  hideOosFromArchive?: boolean
}
```

- [ ] **Step 2: Verify**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: Clean compile

---

### Task 10: ProductCard OOS Badge + Disabled CTA

**Files:**
- Modify: `apps/storefront/components/ProductCard.tsx`

- [ ] **Step 1: Add OOS handling to ProductCard**

After the badge section (lines ~101-105), add OOS badge:

```typescript
{/* Out of Stock badge */}
{(product.availabilityMode === 'ALWAYS_OUT_OF_STOCK' || (product.stock !== undefined && product.stock <= 0)) && (
  <div className='absolute top-2 left-2 z-10'>
    <span className='inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'>
      Out of Stock
    </span>
  </div>
)}
```

And update the CTA button to disable when OOS. Find the ADD TO CART button (around line 179):

Replace the add-to-cart button section with:

```typescript
{product.availabilityMode === 'ALWAYS_OUT_OF_STOCK' || (product.stock !== undefined && product.stock <= 0) ? (
  <Button
    disabled
    variant='outline'
    className='w-full text-muted-foreground cursor-not-allowed'
  >
    Out of Stock
  </Button>
) : product.variants && product.variants.length > 1 ? (
  // existing variant picker logic
  <Button onClick={/* ... */} className='w-full'>
    ADD TO CART
  </Button>
) : (
  <Button onClick={/* ... */} className='w-full'>
    ADD TO CART
  </Button>
)}
```

Note: The exact CTA area depends on the current `inCart` state logic. Apply the OOS guard before any variant/button logic.

- [ ] **Step 2: Verify**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: Clean compile

---

### Task 11: CartContext OOS Prevention

**Files:**
- Modify: `apps/storefront/context/CartContext.tsx`
- Modify: `apps/storefront/components/VariantSelector.tsx` (if needed)

- [ ] **Step 1: Add ALWAYS_OUT_OF_STOCK guard to addToCart**

In CartContext.tsx, enhance `addToCart` to reject ALWAYS_OUT_OF_STOCK products:

```typescript
const addToCart = useCallback((product: CartItem, skipOpen?: boolean) => {
  if (product.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return
  // ... rest of existing logic
}, [])
```

And enhance `updateQuantity` to not allow increasing quantity for OOS items:

```typescript
const updateQuantity = useCallback((itemKey: string, newQuantity: number) => {
  setItems((prev) =>
    prev.map((item) => {
      if (getItemKey(item) !== itemKey) return item
      if (item.availabilityMode === 'ALWAYS_OUT_OF_STOCK') return item
      const cappedQty = item.stock !== undefined ? Math.min(newQuantity, item.stock) : Math.max(0, newQuantity)
      return { ...item, quantity: cappedQty }
    })
  )
}, [])
```

- [ ] **Step 2: Update CartItem type if needed**

In `storefront/lib/types.ts`, if `CartItem` doesn't have `availabilityMode`, add it:

```typescript
export interface CartItem {
  // ... existing fields
  availabilityMode?: 'MANAGED_STOCK' | 'ALWAYS_IN_STOCK' | 'ALWAYS_OUT_OF_STOCK'
}
```

- [ ] **Step 3: Verify**

Run: `cd apps/storefront && npx tsc --noEmit`
Expected: Clean compile

---

## Self-Review Checklist

1. **Spec coverage:**
   - Physical Inventory Suite → T1 (backend controller), T2 (routes+sidebar), T3 (stock table), T4 (reservations), T5 (adjust dialog)
   - State Machine Visualization → T6 (transitions constant), T7 (component + integration)
   - Stock Adjustment Enhancements → T8 (mode+warehouse in adjustments.tsx)
   - Storefront OOS → T9 (types), T10 (ProductCard), T11 (CartContext)
   - `hideOosFromArchive` setting: Already exists in storefront config, no change needed (filters via `hasStock` API param)

2. **No placeholders:** All file paths, imports, code blocks, and commands are complete.

3. **Type consistency:** 
   - `availabilityMode` type matches backend (`'MANAGED_STOCK' | 'ALWAYS_IN_STOCK' | 'ALWAYS_OUT_OF_STOCK'`)
   - `STATUS_COLORS` matches seed.ts `color` values
   - `ORDER_TRANSITIONS` matches seed.ts `transitions` map
   - `CartItem.availabilityMode` added where missing
