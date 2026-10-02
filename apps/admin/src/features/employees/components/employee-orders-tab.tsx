import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hrPerformanceApi, StaffOrderMetrics } from '@/features/hr-performance/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ShoppingBag, CheckCircle2, Truck, RotateCcw, XCircle, ExternalLink } from 'lucide-react'
import { DrilldownDialog } from '@/features/hr-performance/components/drilldown-dialog'

interface EmployeeOrdersTabProps {
  employeeId: string
  employeeName: string
}

export function EmployeeOrdersTab({ employeeId, employeeName }: EmployeeOrdersTabProps) {
  const [drilldownOpen, setDrilldownOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['employee-orders-performance', employeeId],
    queryFn: () => hrPerformanceApi.getOrderPerformance({ employeeId }),
    enabled: !!employeeId,
  })

  const metrics: StaffOrderMetrics | undefined = data?.data?.[0]

  return (
    <div className='space-y-4'>
      {/* Funnel KPI Cards */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Handled
              </span>
              <div className='p-1.5 rounded-lg bg-blue-500/10 text-blue-600'>
                <ShoppingBag className='h-4 w-4' />
              </div>
            </div>
            <p className='mt-2 text-2xl font-bold tabular-nums'>
              {isLoading ? <Skeleton className='h-8 w-16' /> : (metrics?.ordersHandled ?? 0)}
            </p>
            <p className='text-[10px] text-muted-foreground mt-0.5'>Lifetime assigned orders</p>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Confirmed
              </span>
              <div className='p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600'>
                <CheckCircle2 className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2 flex items-baseline gap-1.5'>
              <span className='text-2xl font-bold tabular-nums text-emerald-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : (metrics?.confirmed ?? 0)}
              </span>
              {metrics && (
                <span className='text-xs font-semibold text-emerald-600 tabular-nums'>
                  ({metrics.confirmationRate}%)
                </span>
              )}
            </div>
            <p className='text-[10px] text-muted-foreground mt-0.5'>Confirmed / Handled</p>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Delivered
              </span>
              <div className='p-1.5 rounded-lg bg-purple-500/10 text-purple-600'>
                <Truck className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2 flex items-baseline gap-1.5'>
              <span className='text-2xl font-bold tabular-nums text-purple-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : (metrics?.delivered ?? 0)}
              </span>
              {metrics && (
                <span className='text-xs font-semibold text-purple-600 tabular-nums'>
                  ({metrics.deliveryRate}%)
                </span>
              )}
            </div>
            <p className='text-[10px] text-muted-foreground mt-0.5'>Delivered / Confirmed</p>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Returned
              </span>
              <div className='p-1.5 rounded-lg bg-rose-500/10 text-rose-600'>
                <RotateCcw className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2 flex items-baseline gap-1.5'>
              <span className='text-2xl font-bold tabular-nums text-rose-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : (metrics?.returned ?? 0)}
              </span>
              {metrics && (
                <span className='text-xs font-semibold text-rose-600 tabular-nums'>
                  ({metrics.returnRate}%)
                </span>
              )}
            </div>
            <p className='text-[10px] text-muted-foreground mt-0.5'>Returned / Delivered</p>
          </CardContent>
        </Card>

        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Cancelled
              </span>
              <div className='p-1.5 rounded-lg bg-amber-500/10 text-amber-600'>
                <XCircle className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2 flex items-baseline gap-1.5'>
              <span className='text-2xl font-bold tabular-nums text-amber-600'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : (metrics?.cancelled ?? 0)}
              </span>
              {metrics && (
                <span className='text-xs font-semibold text-amber-600 tabular-nums'>
                  ({metrics.cancellationRate}%)
                </span>
              )}
            </div>
            <p className='text-[10px] text-muted-foreground mt-0.5'>Cancelled / Handled</p>
          </CardContent>
        </Card>
      </div>

      {/* Summary Card with Actions */}
      <Card className='border-border/60'>
        <CardHeader className='p-5 border-b flex flex-row items-center justify-between'>
          <div>
            <CardTitle className='text-base'>Conversion Funnel Performance</CardTitle>
            <CardDescription className='text-xs'>
              Historical attribution based on immutable order timeline &amp; staff operations
            </CardDescription>
          </div>
          <Button
            variant='outline'
            size='sm'
            className='text-xs gap-1.5'
            onClick={() => setDrilldownOpen(true)}
            disabled={!metrics || metrics.ordersHandled === 0}
          >
            <ExternalLink className='h-3.5 w-3.5' /> View Order Records
          </Button>
        </CardHeader>
        <CardContent className='p-5'>
          {isLoading ? (
            <Skeleton className='h-24 w-full' />
          ) : isError ? (
            <div className='text-center py-6 text-rose-500 text-xs'>
              Could not load order performance.
              <Button variant='link' onClick={() => refetch()} className='text-xs ml-2'>
                Retry
              </Button>
            </div>
          ) : !metrics || metrics.ordersHandled === 0 ? (
            <p className='py-8 text-center text-sm text-muted-foreground'>
              No orders have been handled by this staff member yet.
            </p>
          ) : (
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
              <div className='p-4 rounded-xl border border-border/50 bg-muted/20'>
                <p className='text-xs text-muted-foreground'>End-to-End Conversion</p>
                <p className='text-xl font-bold tabular-nums mt-1 text-primary'>
                  {metrics.endToEndDeliveryRate}%
                </p>
                <p className='text-[10px] text-muted-foreground mt-0.5'>
                  {metrics.delivered} delivered out of {metrics.ordersHandled} handled
                </p>
              </div>

              <div className='p-4 rounded-xl border border-border/50 bg-muted/20'>
                <p className='text-xs text-muted-foreground'>Gross Revenue Handled</p>
                <p className='text-xl font-bold tabular-nums mt-1'>
                  ৳{metrics.totalRevenue?.toLocaleString() ?? 0}
                </p>
                <p className='text-[10px] text-muted-foreground mt-0.5'>
                  Total value of delivered orders
                </p>
              </div>

              <div className='p-4 rounded-xl border border-border/50 bg-muted/20'>
                <p className='text-xs text-muted-foreground'>Verification Quality</p>
                <p className='text-xl font-bold tabular-nums mt-1 text-emerald-600'>
                  {100 - metrics.returnRate}%
                </p>
                <p className='text-[10px] text-muted-foreground mt-0.5'>
                  Non-return success rate on delivered orders
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drilldown Dialog */}
      <DrilldownDialog
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
        employeeId={employeeId}
        employeeName={employeeName}
      />
    </div>
  )
}
