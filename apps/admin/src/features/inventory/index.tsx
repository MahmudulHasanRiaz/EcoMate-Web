import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, AlertTriangle } from 'lucide-react'

const inventoryApi = {
  lowStock: () => apiClient.get('/inventory/low-stock'),
  logs: (q: any) => apiClient.get('/inventory/logs', { params: q }),
}

export function Inventory() {
  const { data: lowStock, isLoading: lsLoading } = useQuery({ queryKey: ['inventory-low'], queryFn: () => inventoryApi.lowStock().then(r => r.data) })
  const { data: logs, isLoading: logLoading } = useQuery({ queryKey: ['inventory-logs'], queryFn: () => inventoryApi.logs({ page: 1, perPage: 20 }).then(r => r.data) })

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div><h2 className='text-2xl font-bold tracking-tight'>Inventory</h2></div>

        <Card className='border-orange-200 dark:border-orange-800'>
          <CardHeader className='pb-2'><CardTitle className='text-base flex items-center gap-2'><AlertTriangle className='h-4 w-4 text-orange-500' /> Low Stock Alerts {(lowStock as any)?.count > 0 && <Badge variant='destructive'>{(lowStock as any)?.count}</Badge>}</CardTitle></CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead className='text-right'>Stock</TableHead><TableHead className='text-right'>Alert At</TableHead></TableRow></TableHeader>
              <TableBody>
                {lsLoading ? <TableRow><TableCell colSpan={4} className='text-center'><Loader2 className='animate-spin h-4 w-4 mx-auto' /></TableCell></TableRow> :
                 (lowStock as any)?.products?.length ? (lowStock as any).products.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className='font-medium'>{p.name}</TableCell>
                    <TableCell className='text-muted-foreground text-sm'>{p.sku || '—'}</TableCell>
                    <TableCell className='text-right'><Badge variant='destructive'>{p.stock}</Badge></TableCell>
                    <TableCell className='text-right text-sm text-muted-foreground'>{p.lowStockQty}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={4} className='text-center py-4 text-muted-foreground text-sm'>No low stock alerts</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'><CardTitle className='text-base'>Stock Movement Logs</CardTitle></CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Product</TableHead><TableHead className='text-right'>Qty</TableHead><TableHead>Reason</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {logLoading ? <TableRow><TableCell colSpan={5} className='text-center'><Loader2 className='animate-spin h-4 w-4 mx-auto' /></TableCell></TableRow> :
                 (logs as any)?.data?.length ? (logs as any).data.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell><Badge variant='outline'>{l.type}</Badge></TableCell>
                    <TableCell className='text-sm'>{l.productId?.slice(0,8) || '—'}</TableCell>
                    <TableCell className='text-right font-medium'><Badge variant={l.quantity > 0 ? 'default' : 'destructive'} className='text-xs'>{l.quantity > 0 ? '+' : ''}{l.quantity}</Badge></TableCell>
                    <TableCell className='text-sm text-muted-foreground'>{l.reason || '—'}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{l.createdAt ? new Date(l.createdAt).toLocaleString() : ''}</TableCell>
                  </TableRow>
                )) : <TableRow><TableCell colSpan={5} className='text-center py-4 text-muted-foreground text-sm'>No logs yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
