import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { refundsApi } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Undo2 } from 'lucide-react'

interface RefundRow {
  id: string
  amount: number
  orderId: string
  reason?: string | null
  status: string
  createdAt?: string | null
  order?: { displayId?: string } | null
}

interface RefundsListResponse {
  data: RefundRow[]
  meta?: { total: number; page: number; perPage: number; totalPages: number }
}

/**
 * Refunds ledger (D-B: read-only). Refunds are recorded from the payment
 * ledger — select PAID rows there and hit Refund — so this menu never creates
 * rows itself. The deep-link below carries an optional order number (`?order=`)
 * that prefills the payment-list search.
 */
export function Refunds() {
  const queryClient = useQueryClient()
  const [orderPrefill, setOrderPrefill] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['refunds'],
    queryFn: () => refundsApi.list({ page: 1, perPage: 10 }).then((r) => r.data as RefundsListResponse),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => refundsApi.updateStatus(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['refunds'] }); toast.success('Updated') },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to update refund'),
  })

  const refunds: RefundRow[] = data?.data || []
  const deepLink = orderPrefill.trim()
    ? `/op/payments?order=${encodeURIComponent(orderPrefill.trim())}`
    : '/op/payments'

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-4'>
          <div><h2 className='text-2xl font-bold tracking-tight'>Refunds</h2><p className='text-muted-foreground'>Refund ledger — new refunds are recorded from the payment list.</p></div>
          <div className='flex items-center gap-2'>
            <Input
              value={orderPrefill}
              onChange={(e) => setOrderPrefill(e.target.value)}
              placeholder='Order number (optional)'
              className='h-8 w-48 text-xs'
            />
            <a href={deepLink}>
              <Button size='sm'><Undo2 className='h-4 w-4 mr-1' /> Refund from payment list</Button>
            </a>
          </div>
        </div>
        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader><TableRow><TableHead>Amount</TableHead><TableHead>Order</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={6} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
               refunds.length ? refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className='font-medium'>৳{Number(r.amount).toFixed(2)}</TableCell>
                  <TableCell className='font-mono text-sm'>{r.order?.displayId || r.orderId?.slice(0, 8) || '—'}</TableCell>
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
    </>
  )
}
