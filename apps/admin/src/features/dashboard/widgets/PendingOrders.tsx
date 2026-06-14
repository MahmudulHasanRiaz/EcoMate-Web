'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { formatCurrency } from '../utils'
import type { WidgetProps } from '../types'

export function PendingOrders({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-pending-orders', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getPendingOrders(dateRange.start.toISOString(), dateRange.end.toISOString()),
    refetchInterval: 30_000,
  })

  const orders = data?.data || []

  return (
    <WidgetShell title="Pending Orders" description="Orders needing attention" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No pending orders</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Order</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Items</TableHead>
              <TableHead className="text-xs">Total</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map(order => (
              <TableRow key={order.id}>
                <TableCell className="font-medium text-xs">{order.displayId}</TableCell>
                <TableCell className="text-xs">{order.customerName || (order.customer ? `${order.customer.firstName} ${order.customer.lastName}` : '—')}</TableCell>
                <TableCell className="text-xs">{order.itemCount ?? order._count?.items ?? 0}</TableCell>
                <TableCell className="text-xs">{formatCurrency(order.total)}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{typeof order.status === 'string' ? order.status : order.status?.name}</Badge></TableCell>
                <TableCell>
                  <Link to="/op/orders/$id" params={{ id: order.id }}>
                    <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-3 w-3" /></Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </WidgetShell>
  )
}
