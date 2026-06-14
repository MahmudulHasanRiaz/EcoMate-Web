'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eye, Play, Truck, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { ordersApi } from '@/features/orders/api'
import { apiClient } from '@/lib/api-client'
import { formatCurrency, formatDate } from '../utils'
import type { WidgetProps } from '../types'
import { toast } from 'sonner'

export function PendingOrders({ dateRange }: WidgetProps) {
  const queryClient = useQueryClient()

  // Fetch pending orders
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-pending-orders', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getPendingOrders(dateRange.start.toISOString(), dateRange.end.toISOString()),
    refetchInterval: 30_000,
  })

  // Fetch all order statuses for transition lookups
  const { data: statusesData } = useQuery({
    queryKey: ['order-statuses'],
    queryFn: () => apiClient.get('/order-statuses').then(r => r.data as any[]),
  })

  const orders = data?.data || []

  // Status transitions
  const confirmedStatus = statusesData?.find(s => s.name === 'Confirmed')
  const shippedStatus = statusesData?.find(s => s.name === 'Shipped')

  const updateStatusMut = useMutation({
    mutationFn: ({ orderId, statusId, statusName }: { orderId: string; statusId: string; statusName: string }) =>
      ordersApi.updateStatus(orderId, statusId, `Transitioned to ${statusName} from Operations Dashboard`),
    onSuccess: (_, variables) => {
      toast.success(`Order status updated to ${variables.statusName}`)
      queryClient.invalidateQueries({ queryKey: ['dashboard-pending-orders'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-today-kpi'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats-kpi'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-activity'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-pending-payments-alerts'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to update order status')
    },
  })

  const handleProcess = (orderId: string) => {
    if (!confirmedStatus) {
      toast.error('Confirmed status configuration not loaded')
      return
    }
    updateStatusMut.mutate({ orderId, statusId: confirmedStatus.id, statusName: 'Confirmed' })
  }

  const handleShip = (orderId: string) => {
    if (!shippedStatus) {
      toast.error('Shipped status configuration not loaded')
      return
    }
    updateStatusMut.mutate({ orderId, statusId: shippedStatus.id, statusName: 'Shipped' })
  }

  const getStatusBadgeStyle = (statusName: string) => {
    const normalized = statusName.toLowerCase()
    if (normalized.includes('pending') || normalized.includes('awaiting')) {
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    }
    if (normalized.includes('delivered') || normalized === 'paid') {
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    }
    if (normalized.includes('refund') || normalized.includes('cancelled') || normalized.includes('fail') || normalized.includes('damage') || normalized === 'returned') {
      return 'bg-rose-500/10 text-rose-600 border-rose-500/20'
    }
    if (normalized.includes('process')) {
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    }
    if (normalized.includes('confirm')) {
      return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20'
    }
    return 'bg-muted text-muted-foreground border-border'
  }

  return (
    <WidgetShell
      title="Pending Orders"
      description="Orders needing immediate processing"
      isLoading={isLoading}
      error={error ?? undefined}
      onRetry={() => refetch()}
    >
      {orders.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="text-sm font-semibold text-foreground">All orders processed successfully</p>
          <p className="text-xs text-muted-foreground mt-1">Excellent job! No pending orders remaining.</p>
        </div>
      ) : (
        <>
          {/* Desktop/Tablet Table View */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Order ID</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Customer Name</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Created Time</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(order => (
                  <TableRow key={order.id} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs text-foreground font-mono">{order.displayId}</TableCell>
                    <TableCell className="text-xs font-medium text-foreground">{order.customerName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                    <TableCell className="text-xs font-bold text-foreground text-right">{formatCurrency(order.total)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] font-bold border capitalize ${getStatusBadgeStyle(order.status)}`}>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        <Link to="/op/orders/$id" params={{ id: order.id }}>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="View details">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleProcess(order.id)}
                          disabled={updateStatusMut.isPending}
                          className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50/50"
                          title="Confirm & Process Order"
                        >
                          <Play className="h-3.5 w-3.5 fill-blue-600" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleShip(order.id)}
                          disabled={updateStatusMut.isPending}
                          className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50"
                          title="Ship Order"
                        >
                          <Truck className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card Layout (<768px) */}
          <div className="block md:hidden space-y-3">
            {orders.map(order => (
              <div key={order.id} className="rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-foreground">{order.displayId}</span>
                  <Badge variant="outline" className={`text-[10px] font-bold border capitalize ${getStatusBadgeStyle(order.status)}`}>
                    {order.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Customer</span>
                    <span className="font-medium text-foreground">{order.customerName}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider text-right">Amount</span>
                    <span className="font-bold text-foreground">{formatCurrency(order.total)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Created</span>
                    <span className="text-muted-foreground">{formatDate(order.createdAt)}</span>
                  </div>
                </div>

                {/* Mobile Touch Actions (Min 44px height targets) */}
                <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                  <Link to="/op/orders/$id" params={{ id: order.id }} className="flex-1">
                    <Button variant="outline" className="w-full h-11 text-xs gap-1.5 font-bold">
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    onClick={() => handleProcess(order.id)}
                    disabled={updateStatusMut.isPending}
                    className="flex-1 h-11 text-xs gap-1.5 font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50/50"
                  >
                    <Play className="h-4 w-4 fill-blue-600" />
                    Process
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleShip(order.id)}
                    disabled={updateStatusMut.isPending}
                    className="flex-1 h-11 text-xs gap-1.5 font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50/50"
                  >
                    <Truck className="h-4 w-4" />
                    Ship
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </WidgetShell>
  )
}
