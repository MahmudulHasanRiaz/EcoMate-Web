import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Plus } from 'lucide-react'
import type { PaginationState } from '@tanstack/react-table'

const refundsApi = {
  list: (q: any) => apiClient.get('/refunds', { params: q }),
  create: (d: any) => apiClient.post('/refunds', d),
  updateStatus: (id: string, status: string) => apiClient.put(`/refunds/${id}/status`, { status }),
}

export function Refunds() {
  const queryClient = useQueryClient()
  const [pagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ orderId: '', amount: '', reason: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['refunds', pagination],
    queryFn: () => refundsApi.list({ page: pagination.pageIndex + 1, perPage: pagination.pageSize }).then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: refundsApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['refunds'] }); setCreateOpen(false); setForm({ orderId: '', amount: '', reason: '' }); toast.success('Refund created') },
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => refundsApi.updateStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['refunds'] }); toast.success('Updated') },
  })

  const refunds = (data as any)?.data || []

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between'>
          <div><h2 className='text-2xl font-bold tracking-tight'>Refunds</h2><p className='text-muted-foreground'>Process refund requests.</p></div>
          <Button size='sm' onClick={() => setCreateOpen(true)}><Plus className='h-4 w-4 mr-1' /> New Refund</Button>
        </div>
        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader><TableRow><TableHead>Amount</TableHead><TableHead>Order</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={6} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
               refunds.length ? refunds.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className='font-medium'>৳{Number(r.amount).toFixed(2)}</TableCell>
                  <TableCell className='font-mono text-sm'>{r.orderId ? r.orderId.slice(0,8) : '—'}</TableCell>
                  <TableCell className='text-sm max-w-48 truncate'>{r.reason || '—'}</TableCell>
                  <TableCell>
                    <Badge className={r.status === 'approved' ? 'bg-green-500' : r.status === 'rejected' ? 'bg-destructive' : r.status === 'completed' ? 'bg-blue-500' : ''}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}</TableCell>
                  <TableCell className='flex gap-1'>
                    {r.status === 'pending' && <Button variant='outline' size='sm' className='h-7 text-xs text-green-600' onClick={() => statusMut.mutate({ id: r.id, status: 'approved' })}>Approve</Button>}
                    {r.status === 'pending' && <Button variant='outline' size='sm' className='h-7 text-xs text-destructive' onClick={() => statusMut.mutate({ id: r.id, status: 'rejected' })}>Reject</Button>}
                    {r.status === 'approved' && <Button variant='outline' size='sm' className='h-7 text-xs' onClick={() => statusMut.mutate({ id: r.id, status: 'completed' })}>Complete</Button>}
                  </TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>No refunds yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Refund</DialogTitle></DialogHeader>
          <div className='space-y-3 py-2'>
            <div><Label>Order ID</Label><Input value={form.orderId} onChange={e => setForm({ ...form, orderId: e.target.value })} placeholder='Order UUID' /></div>
            <div><Label>Amount</Label><Input type='number' value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder='0.00' /></div>
            <div><Label>Reason</Label><Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder='Reason for refund...' /></div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate({ orderId: form.orderId, amount: parseFloat(form.amount), reason: form.reason })}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
