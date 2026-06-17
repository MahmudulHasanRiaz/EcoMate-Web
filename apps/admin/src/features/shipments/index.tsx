import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Pencil } from 'lucide-react'
import type { PaginationState } from '@tanstack/react-table'

const shipmentsApi = {
  list: (q: any) => apiClient.get('/shipments', { params: q }),
  upsert: (orderId: string, d: any) => apiClient.put(`/shipments/order/${orderId}`, d),
}

export function Shipments() {
  const queryClient = useQueryClient()
  const [pagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [editShipment, setEditShipment] = useState<any>(null)
  const [form, setForm] = useState({ trackingNo: '', courier: '', status: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', pagination],
    queryFn: () => shipmentsApi.list({ page: pagination.pageIndex + 1, perPage: pagination.pageSize }).then(r => r.data),
  })

  const upsertMut = useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => shipmentsApi.upsert(orderId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['shipments'] }); setEditShipment(null); toast.success('Saved') },
  })

  const shipments = (data as any)?.data || []

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div><h2 className='text-2xl font-bold tracking-tight'>Shipments</h2><p className='text-muted-foreground'>Manage order shipments.</p></div>
        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Courier</TableHead><TableHead>Tracking #</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={5} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
               shipments.length ? shipments.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className='font-mono text-sm'>{s.order?.displayId || s.orderId?.slice(0,8) || '—'}</TableCell>
                  <TableCell>{s.courier || '—'}</TableCell>
                  <TableCell className='font-mono text-sm'>{s.trackingNo || '—'}</TableCell>
                  <TableCell><Badge variant='outline'>{s.status}</Badge></TableCell>
                  <TableCell>
                    <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => { setEditShipment(s); setForm({ trackingNo: s.trackingNo || '', courier: s.courier || '', status: s.status || 'pending' }) }}>
                      <Pencil className='h-3.5 w-3.5' />
                    </Button>
                  </TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={5} className='text-center py-8 text-muted-foreground'>No shipments yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Main>

      <Dialog open={!!editShipment} onOpenChange={() => setEditShipment(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Shipment</DialogTitle></DialogHeader>
          <div className='space-y-3 py-2'>
            <div><Label>Courier</Label><Input value={form.courier} onChange={e => setForm({ ...form, courier: e.target.value })} placeholder='RedX / Steadfast / Pathao' /></div>
            <div><Label>Tracking Number</Label><Input value={form.trackingNo} onChange={e => setForm({ ...form, trackingNo: e.target.value })} placeholder='TRK123456' /></div>
            <div><Label>Status</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value='pending'>Pending</option><option value='in_transit'>In Transit</option><option value='delivered'>Delivered</option><option value='returned'>Returned</option>
            </select></div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditShipment(null)}>Cancel</Button>
            <Button onClick={() => upsertMut.mutate({ orderId: editShipment.orderId, data: form })}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
