'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { formatCurrency, formatDate } from '../utils'
import type { WidgetProps } from '../types'

export function RecentOrders({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-recent-orders', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getStats(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const orders = data?.data.recentOrders || []

  return (
    <WidgetShell title="Recent Orders" isLoading={isLoading} error={error} onRetry={() => refetch()}>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No orders</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Order</TableHead>
              <TableHead className="text-xs">Items</TableHead>
              <TableHead className="text-xs">Total</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map(order => (
              <TableRow key={order.id}>
                <TableCell className="font-medium text-xs">{order.displayId}</TableCell>
                <TableCell className="text-xs">{order.itemCount}</TableCell>
                <TableCell className="text-xs">{formatCurrency(order.total)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
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
