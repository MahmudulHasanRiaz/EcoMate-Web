import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Check, X } from 'lucide-react'
import { PaymentLogo } from '@/components/payment-logo'
import type { PaginationState } from '@tanstack/react-table'

interface PaymentResponse {
  id: string; orderId: string; gatewayCode: string; amount: number;
  transactionId?: string | null; screenshot?: string | null;
  status: string; verifiedBy?: string | null; verifiedAt?: string | null;
  notes?: string | null; createdAt: string;
  order: { displayId: string };
  verifier?: { id: string; firstName: string; lastName: string } | null;
}

const paymentsApi = {
  list: (query?: any) => apiClient.get('/payments', { params: query }),
  verify: (id: string, status: string) => apiClient.put(`/payments/${id}/verify`, { status }),
}

export function Payments() {
  const queryClient = useQueryClient()
  const [pagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  const { data, isLoading } = useQuery({
    queryKey: ['payments', pagination],
    queryFn: () => paymentsApi.list({ page: pagination.pageIndex + 1, perPage: pagination.pageSize }).then(r => r.data),
  })

  const verifyMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => paymentsApi.verify(id, status),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payments'] }); toast.success('Payment updated') },
  })

  const payments: PaymentResponse[] = (data as any)?.data || []

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Payments</h2>
          <p className='text-muted-foreground'>Verify and manage manual payments.</p>
        </div>
        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>TrxID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verified By</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow>
                ) : payments.length ? payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className='font-mono text-sm'>{p.order.displayId}</TableCell>
                    <TableCell>
                      <PaymentLogo method={p.gatewayCode} size='sm' showName={false} />
                    </TableCell>
                    <TableCell className='font-medium'>৳{Number(p.amount).toFixed(2)}</TableCell>
                    <TableCell className='font-mono text-xs'>{p.transactionId || '—'}</TableCell>
                    <TableCell>
                      {p.status === 'pending' && <Badge variant='outline' className='text-xs border-yellow-500 text-yellow-600'>Pending</Badge>}
                      {p.status === 'verified' && <Badge className='text-xs bg-green-500'>Verified</Badge>}
                      {p.status === 'rejected' && <Badge variant='destructive' className='text-xs'>Rejected</Badge>}
                    </TableCell>
                    <TableCell>
                      {p.verifier ? (
                        <Link
                          to='/mon/users/$id'
                          params={{ id: p.verifier.id }}
                          className='text-xs text-muted-foreground hover:text-brand-blue hover:underline'
                        >
                          {p.verifier.firstName} {p.verifier.lastName}
                        </Link>
                      ) : (
                        <span className='text-xs text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.status === 'pending' && (
                        <div className='flex gap-1'>
                          <Button size='icon' variant='ghost' className='h-7 w-7 text-green-600' onClick={() => verifyMut.mutate({ id: p.id, status: 'verified' })}><Check className='h-4 w-4' /></Button>
                          <Button size='icon' variant='ghost' className='h-7 w-7 text-destructive' onClick={() => verifyMut.mutate({ id: p.id, status: 'rejected' })}><X className='h-4 w-4' /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>No payments yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
