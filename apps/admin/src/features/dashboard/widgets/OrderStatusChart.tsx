'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { WidgetShell } from '../components/WidgetShell'
import { dashboardApi } from '../api'
import type { WidgetProps } from '../types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308', '#ec4899', '#f43f5e', '#a855f7']

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border bg-card/90 backdrop-blur-md p-2.5 shadow-md border-border">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{payload[0].name}</p>
        <p className="text-sm font-bold text-foreground mt-0.5">Orders: {payload[0].value}</p>
      </div>
    )
  }
  return null
}

export function OrderStatusChart({ dateRange, userRole }: WidgetProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-order-status', dateRange.start.toISOString(), dateRange.end.toISOString()],
    queryFn: () => dashboardApi.getOrderStatusDistribution(dateRange.start.toISOString(), dateRange.end.toISOString()),
  })

  const chartData = data?.data || []
  const isAdmin = ['superadmin', 'admin'].includes(userRole)

  const formatBDT = (amount: number) => {
    return '৳' + Number(amount).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <>
      <WidgetShell
        title="Order Status"
        isLoading={isLoading}
        error={error ?? undefined}
        onRetry={() => refetch()}
        action={
          chartData.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setIsModalOpen(true)}>
              View All
            </Button>
          ) : null
        }
      >
        {chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground text-sm">
            No orders in this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </WidgetShell>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Status Distribution Report</DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden border rounded-xl mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Orders</TableHead>
                  {isAdmin && <TableHead className="text-right">Total Amount</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {chartData.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-semibold">{row.status}</TableCell>
                    <TableCell className="text-right font-medium">{row.count}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right font-bold text-blue-600 dark:text-blue-400">
                        {formatBDT(row.totalAmount || 0)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-bold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">
                    {chartData.reduce((sum, item) => sum + item.count, 0)}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right text-blue-600 dark:text-blue-400">
                      {formatBDT(chartData.reduce((sum, item) => sum + (item.totalAmount || 0), 0))}
                    </TableCell>
                  )}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
