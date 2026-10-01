import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, Clock, Package, TrendingUp, ListTodo, ShoppingBag, UserCheck, AlertCircle } from 'lucide-react'
import type { MyPerformanceResponse } from '../api'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function PerformanceTab({
  performance,
  isLoading,
}: {
  performance?: MyPerformanceResponse
  isLoading: boolean
}) {
  if (isLoading || !performance) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="py-12">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  const { orders, leads, tasks, attendance } = performance

  return (
    <div className="space-y-6">
      {/* KPI Metric Cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Order Delivery Rate</span>
              <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-600">
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">{orders.deliveryRate}%</span>
              <span className="text-xs text-muted-foreground">
                ({orders.deliveredOrders}/{orders.totalAssignedOrders})
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Delivered: {orders.totalDeliveredAmount.toLocaleString()} ৳
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Lead Conversion</span>
              <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-600">
                <UserCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">{leads.conversionRate}%</span>
              <span className="text-xs text-muted-foreground">
                ({leads.convertedLeads}/{leads.assignedLeads})
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {leads.convertedLeads} leads converted
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Tasks Done</span>
              <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-600">
                <ListTodo className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">{tasks.completionRate}%</span>
              <span className="text-xs text-muted-foreground">
                ({tasks.completedTasks}/{tasks.totalTasks})
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {tasks.pendingTasks} pending tasks
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Attendance &amp; Hours</span>
              <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-600">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">{attendance.workedHours}h</span>
              <span className="text-xs text-muted-foreground">
                ({attendance.presentDays} days present)
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              On-time: {attendance.onTimeRate}% · Late: {attendance.lateDays}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Orders Breakdown */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" />
                Assigned Orders Performance
              </CardTitle>
              <CardDescription>
                Summary of orders assigned to you for verification, packing, or processing.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Total: {orders.totalAssignedOrders}
              </Badge>
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                Delivered: {orders.deliveredOrders}
              </Badge>
              <Badge variant="secondary" className="bg-blue-500/10 text-blue-700 dark:text-blue-400">
                Processing: {orders.processingOrders}
              </Badge>
              {orders.cancelledOrders > 0 && (
                <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                  Cancelled: {orders.cancelledOrders}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {orders.recentOrders.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No orders assigned to your account yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Order ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Assigned Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.recentOrders.map((ord) => (
                    <TableRow key={ord.id}>
                      <TableCell className="font-mono font-medium text-xs">
                        {ord.displayId}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{ord.customerName}</div>
                        {ord.customerPhone && (
                          <div className="text-xs text-muted-foreground">{ord.customerPhone}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {ord.total.toLocaleString()} ৳
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          style={{
                            borderColor: `${ord.statusColor}40`,
                            backgroundColor: `${ord.statusColor}15`,
                            color: ord.statusColor,
                          }}
                          className="font-medium text-[11px]"
                        >
                          {ord.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDate(ord.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tasks & Work Stream */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-purple-600" />
              Assigned Tasks
            </CardTitle>
            <CardDescription>Tasks and assignments currently on your queue.</CardDescription>
          </CardHeader>
          <CardContent>
            {tasks.recentTasks.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No active tasks assigned.
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.recentTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/50 bg-muted/20"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{t.displayId}</span>
                        <span className="text-sm font-medium truncate">{t.title}</span>
                      </div>
                      {t.dueDate && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Due: {new Date(t.dueDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant="secondary"
                        className={
                          t.status === 'done'
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {t.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Work &amp; Conversion Summary
            </CardTitle>
            <CardDescription>Highlights of your conversion and attendance record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3.5 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Leads Converted to Orders</span>
                <span className="font-semibold text-foreground">{leads.conversionRate}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all"
                  style={{ width: `${Math.min(100, leads.conversionRate)}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{leads.convertedLeads} converted</span>
                <span>{leads.assignedLeads} total leads</span>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3.5 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Monthly Punctuality (On-Time)</span>
                <span className="font-semibold text-foreground">{attendance.onTimeRate}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-600 rounded-full transition-all"
                  style={{ width: `${Math.min(100, attendance.onTimeRate)}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{attendance.presentDays} on-time days</span>
                <span>{attendance.lateDays} late entries</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
