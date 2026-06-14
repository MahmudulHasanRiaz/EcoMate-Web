'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eye, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import { formatCurrency, formatDate } from '../utils'
import type { WidgetProps } from '../types'

export function RecentOrders({ dateRange }: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-recent-orders-list', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getStats(dateRange.start.toISOString(), dateRange.end.toISOString()),
    refetchInterval: 30_000,
  })

  // Determine initial limit based on screen width
  const [limit, setLimit] = useState(10)
  
  useEffect(() => {
    const handleResize = () => {
      setLimit(window.innerWidth < 768 ? 5 : 10)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const orders = data?.data?.recentOrders || []
  const visibleOrders = orders.slice(0, limit)
  const hasMore = orders.length > limit

  const handleLoadMore = () => {
    setLimit(prev => Math.min(prev + 5, orders.length))
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
      title="Recent Orders"
      description="Latest orders across the store"
      isLoading={isLoading}
      error={error ?? undefined}
      onRetry={() => refetch()}
    >
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No recent orders</p>
      ) : (
        <>
          {/* Desktop/Tablet Table view */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Order ID</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Items</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-right">Total</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider">Date</TableHead>
                  <TableHead className="text-xs font-bold uppercase tracking-wider text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleOrders.map(order => (
                  <TableRow key={order.id} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs text-foreground font-mono">{order.displayId}</TableCell>
                    <TableCell className="text-xs font-medium text-foreground text-right">{order.itemCount}</TableCell>
                    <TableCell className="text-xs font-bold text-foreground text-right">{formatCurrency(order.total)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] font-bold border capitalize ${getStatusBadgeStyle(order.status)}`}>
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Link to="/op/orders/$id" params={{ id: order.id }}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card View (<768px) */}
          <div className="block md:hidden space-y-3">
            {visibleOrders.map(order => (
              <div key={order.id} className="rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-foreground">{order.displayId}</span>
                  <Badge variant="outline" className={`text-[10px] font-bold border capitalize ${getStatusBadgeStyle(order.status)}`}>
                    {order.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Items</span>
                    <span className="font-medium text-foreground">{order.itemCount} items</span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider text-right">Total</span>
                    <span className="font-bold text-foreground">{formatCurrency(order.total)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Date</span>
                    <span className="text-muted-foreground">{formatDate(order.createdAt)}</span>
                  </div>
                </div>

                {/* Mobile Touch Action */}
                <div className="pt-2 border-t border-border/50">
                  <Link to="/op/orders/$id" params={{ id: order.id }}>
                    <Button variant="outline" className="w-full h-11 text-xs gap-1.5 font-bold">
                      <Eye className="h-4 w-4" />
                      View Details
                    </Button>
                  </Link>
                </div>
              </div>
            ))}

            {hasMore && (
              <Button
                variant="outline"
                onClick={handleLoadMore}
                className="w-full h-11 text-xs font-bold text-primary border-primary/20 hover:bg-primary/5 mt-2 flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="h-4 w-4 animate-spin-slow" />
                Load More
              </Button>
            )}
          </div>

          {/* View All Orders Link */}
          <div className="flex justify-center pt-3.5 border-t border-border/50 mt-4">
            <Link to="/op/orders" className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-0.5">
              View All Orders
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </>
      )}
    </WidgetShell>
  )
}
