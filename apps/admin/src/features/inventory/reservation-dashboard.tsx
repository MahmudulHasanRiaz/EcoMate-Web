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
