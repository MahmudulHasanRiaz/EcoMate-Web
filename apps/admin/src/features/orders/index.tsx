import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ordersApi, type OrderResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Eye } from 'lucide-react'
import type { PaginationState } from '@tanstack/react-table'

const statusColors: Record<string, string> = {
  Pending: '#F59E0B', Confirmed: '#3B82F6', Cancelled: '#EF4444', 'On Hold': '#8B5CF6',
  Packed: '#06B6D4', Shipped: '#10B981', 'In Courier': '#6366F1', Delivered: '#22C55E',
  'Partial Return': '#F97316', 'Return Pending': '#EC4899', Returned: '#DC2626', Damaged: '#991B1B',
}

export function Orders() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [selectedOrder, setSelectedOrder] = useState<OrderResponse | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', pagination],
    queryFn: () => ordersApi.list({ page: pagination.pageIndex + 1, perPage: pagination.pageSize }).then(r => r.data),
  })

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Orders</h2>
          <p className='text-muted-foreground'>Manage customer orders and track fulfillment.</p>
        </div>
        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Total</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow>
                ) : data?.data?.length ? data.data.map(order => (
                  <TableRow key={order.id} className='cursor-pointer hover:bg-muted/50' onClick={() => setSelectedOrder(order)}>
                    <TableCell className='font-mono text-sm font-medium'>{order.displayId}</TableCell>
                    <TableCell>
                      <div className='text-sm font-medium'>{order.customer.firstName} {order.customer.lastName}</div>
                      <div className='text-xs text-muted-foreground'>{order.customer.phoneNumber}</div>
                    </TableCell>
                    <TableCell>
                      <Badge style={{ backgroundColor: statusColors[order.status.name] || '#6B7280', color: '#fff' }} className='text-xs'>
                        {order.status.name}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right font-medium'>${order.total}</TableCell>
                    <TableCell>{order.items.length}</TableCell>
                    <TableCell className='text-xs text-muted-foreground'>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell><Button variant='ghost' size='icon' onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}><Eye className='h-4 w-4' /></Button></TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>No orders yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {data?.meta && data.meta.totalPages > 1 && (
          <div className='flex items-center justify-between'>
            <span className='text-sm text-muted-foreground'>Page {pagination.pageIndex + 1} of {data.meta.totalPages}</span>
            <div className='flex gap-2'>
              <Button variant='outline' size='sm' disabled={pagination.pageIndex === 0} onClick={() => setPagination(p => ({ ...p, pageIndex: p.pageIndex - 1 }))}>Previous</Button>
              <Button variant='outline' size='sm' disabled={pagination.pageIndex + 1 >= data.meta.totalPages} onClick={() => setPagination(p => ({ ...p, pageIndex: p.pageIndex + 1 }))}>Next</Button>
            </div>
          </div>
        )}

        <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
          <DialogContent className='max-w-2xl max-h-[80vh] overflow-y-auto'>
            <DialogHeader><DialogTitle>Order {selectedOrder?.displayId}</DialogTitle></DialogHeader>
            {selectedOrder && (
              <div className='space-y-4'>
                <div className='grid grid-cols-2 gap-4'>
                  <div>
                    <p className='text-sm text-muted-foreground'>Customer</p>
                    <p className='font-medium'>{selectedOrder.customer.firstName} {selectedOrder.customer.lastName}</p>
                    <p className='text-sm'>{selectedOrder.customer.email}</p>
                    <p className='text-sm'>{selectedOrder.customer.phoneNumber}</p>
                  </div>
                  <div>
                    <p className='text-sm text-muted-foreground'>Status</p>
                    <Badge style={{ backgroundColor: statusColors[selectedOrder.status.name] || '#6B7280', color: '#fff' }}>{selectedOrder.status.name}</Badge>
                    <p className='text-sm mt-1'>Total: <strong>${selectedOrder.total}</strong></p>
                    <p className='text-sm'>Shipping: ${selectedOrder.shippingCharge}</p>
                  </div>
                </div>
                <div>
                  <p className='text-sm font-medium mb-2'>Items</p>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Product</TableHead><TableHead className='text-right'>Qty</TableHead><TableHead className='text-right'>Price</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedOrder.items.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.product.name}</TableCell>
                          <TableCell className='text-right'>{item.quantity}</TableCell>
                          <TableCell className='text-right'>${item.price}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {selectedOrder.timeline && selectedOrder.timeline.length > 0 && (
                  <div>
                    <p className='text-sm font-medium mb-2'>Timeline</p>
                    <div className='space-y-2'>
                      {(selectedOrder.timeline as any[]).map((t: any, i: number) => (
                        <div key={i} className='flex gap-3 text-sm'>
                          <span className='text-muted-foreground w-28'>{new Date(t.timestamp).toLocaleString()}</span>
                          <Badge style={{ backgroundColor: statusColors[t.status] || '#6B7280', color: '#fff' }} className='text-xs'>{t.status}</Badge>
                          {t.note && <span className='text-muted-foreground'>{t.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedOrder.payments.length > 0 && (
                  <div>
                    <p className='text-sm font-medium mb-2'>Payments</p>
                    {selectedOrder.payments.map(p => (
                      <div key={p.id} className='flex gap-3 text-sm items-center'>
                        <Badge variant='outline'>{p.method}</Badge>
                        <span>${p.amount}</span>
                        <Badge variant={p.status === 'verified' ? 'default' : 'secondary'} className={p.status === 'verified' ? 'bg-green-500' : ''}>{p.status}</Badge>
                        {p.transactionId && <span className='text-muted-foreground'>TrxID: {p.transactionId}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
