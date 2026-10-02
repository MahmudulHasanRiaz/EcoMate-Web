import { useAuthStore } from '@/stores/auth-store'
import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ShoppingBag,
  CheckCircle2,
  Truck,
  RotateCcw,
  XCircle,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useOrderPerformanceQuery, useBackfillOrderEventsMutation } from '../hooks'
import { DrilldownDialog } from './drilldown-dialog'
import { StaffOrderMetrics } from '../api'

interface OrderPerformanceTabProps {
  from?: string
  to?: string
  departmentId?: string
  employeeId?: string
}

export function OrderPerformanceTab({
  from,
  to,
  departmentId,
  employeeId,
}: OrderPerformanceTabProps) {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, refetch } = useOrderPerformanceQuery({
    from,
    to,
    departmentId,
    employeeId,
    page,
    perPage: 15,
  })

  const [drilldownEmp, setDrilldownEmp] = useState<{ id: string; name: string } | null>(null)
  const backfillMut = useBackfillOrderEventsMutation()
  const permissions = useAuthStore((s) => s.auth.user?.permissions) ?? []

  // Mirrors @Roles('superadmin','admin') + @PermissionsAny('manage_hr_settings')
  // on POST /hr/performance/orders/backfill.
  const canRunBackfill =
    (permissions.includes('superadmin') || permissions.includes('admin') || permissions.includes('manage_hr_settings'))

  const summary = data?.summary
  const employees = data?.data || []
  const meta = data?.meta

  return (
    <div className='space-y-4'>
      {/* 5 Funnel KPI Cards */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
        <Card className='border-border/60 bg-card'>
          <CardContent className='p-4'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                Orders Handled
              </span>
              <div className='p-1.5 rounded-lg bg-blue-500/10 text-blue-600'>
                <ShoppingBag className='h-4 w-4' />
              </div>
            </div>
            <div className='mt-2'>
              <span className='text-2xl font-bold tabular-nums'>
                {isLoading ? <Skeleton className='h-8 w-16' /> : (summary?.totalOrdersHandled ?? 0)}
              </span>
              <p className='text-[11px] text-muted-foreground mt-0.5'>
                Assigned / touched cohort
              </p>
            </div>
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
            <div className='mt-2'>
              <div className='flex items-baseline gap-1.5'>
                <span className='text-2xl font-bold tabular-nums'>
                  {isLoading ? <Skeleton className='h-8 w-16' /> : (summary?.totalConfirmed ?? 0)}
                </span>
                {summary && (
                  <span className='text-xs font-semibold text-emerald-600 tabular-nums'>
                    {summary.overallConfirmationRate}%
                  </span>
                )}
              </div>
              <p className='text-[11px] text-muted-foreground mt-0.5 tabular-nums'>
                {summary?.totalConfirmed ?? 0} / {summary?.totalOrdersHandled ?? 0}
              </p>
            </div>
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
            <div className='mt-2'>
              <div className='flex items-baseline gap-1.5'>
                <span className='text-2xl font-bold tabular-nums'>
                  {isLoading ? <Skeleton className='h-8 w-16' /> : (summary?.totalDelivered ?? 0)}
                </span>
                {summary && (
                  <span className='text-xs font-semibold text-purple-600 tabular-nums'>
                    {summary.overallDeliveryRate}%
                  </span>
                )}
              </div>
              <p className='text-[11px] text-muted-foreground mt-0.5 tabular-nums'>
                {summary?.totalDelivered ?? 0} / {summary?.totalConfirmed ?? 0}
              </p>
            </div>
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
            <div className='mt-2'>
              <div className='flex items-baseline gap-1.5'>
                <span className='text-2xl font-bold tabular-nums text-rose-600'>
                  {isLoading ? <Skeleton className='h-8 w-16' /> : (summary?.totalReturned ?? 0)}
                </span>
                {summary && (
                  <span className='text-xs font-semibold text-rose-600 tabular-nums'>
                    {summary.overallReturnRate}%
                  </span>
                )}
              </div>
              <p className='text-[11px] text-muted-foreground mt-0.5 tabular-nums'>
                {summary?.totalReturned ?? 0} / {summary?.totalDelivered ?? 0}
              </p>
            </div>
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
            <div className='mt-2'>
              <div className='flex items-baseline gap-1.5'>
                <span className='text-2xl font-bold tabular-nums text-amber-600'>
                  {isLoading ? <Skeleton className='h-8 w-16' /> : (summary?.totalCancelled ?? 0)}
                </span>
                {summary && (
                  <span className='text-xs font-semibold text-amber-600 tabular-nums'>
                    {summary.overallCancellationRate}%
                  </span>
                )}
              </div>
              <p className='text-[11px] text-muted-foreground mt-0.5 tabular-nums'>
                {summary?.totalCancelled ?? 0} / {summary?.totalOrdersHandled ?? 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table */}
      <Card className='border-border/60'>
        <div className='p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b'>
          <div>
            <h3 className='font-bold text-base'>Staff Order Funnel Breakdown</h3>
            <p className='text-xs text-muted-foreground'>
              Individual operator conversion rates with explicit denominator cohorts
            </p>
          </div>
          {/* The backend restricts this bulk write to superadmin/admin with
              manage_hr_settings. Rendering the button for everyone else just
              produced a guaranteed 403. */}
          {canRunBackfill && (
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                className='text-xs h-8 gap-1.5'
                disabled={backfillMut.isPending}
                onClick={() => backfillMut.mutate()}
              >
                <RotateCcw className={`h-3.5 w-3.5 ${backfillMut.isPending ? 'animate-spin' : ''}`} />
                Sync Historical Events
              </Button>
            </div>
          )}
        </div>

        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='bg-muted/30'>
              <TableRow>
                <TableHead className='min-w-[200px]'>Employee</TableHead>
                <TableHead className='text-center'>Handled</TableHead>
                <TableHead className='text-center'>
                  <HeaderWithTooltip
                    label='Confirmed'
                    formula='Confirmed / Handled'
                    explanation='Percentage of handled orders verified and confirmed by this staff member'
                  />
                </TableHead>
                <TableHead className='text-center'>
                  <HeaderWithTooltip
                    label='Delivered'
                    formula='Delivered / Confirmed'
                    explanation='Orders successfully delivered from the confirmed cohort'
                  />
                </TableHead>
                <TableHead className='text-center'>
                  <HeaderWithTooltip
                    label='Returned'
                    formula='Returned / Delivered'
                    explanation='Delivered orders returned by customers or couriers'
                  />
                </TableHead>
                <TableHead className='text-center'>
                  <HeaderWithTooltip
                    label='Cancelled'
                    formula='Cancelled / Handled'
                    explanation='Handled orders dropped or cancelled before completion'
                  />
                </TableHead>
                <TableHead className='text-center'>
                  <HeaderWithTooltip
                    label='End-to-End Delivery'
                    formula='Delivered / Handled'
                    explanation='Net completion rate from initial assignment to final doorstep delivery'
                  />
                </TableHead>
                <TableHead className='text-right'>Revenue</TableHead>
                <TableHead className='text-right w-[80px]'>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className='h-8 w-40' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-12 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-24 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-24 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-24 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-24 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-24 mx-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-16 ml-auto' /></TableCell>
                    <TableCell><Skeleton className='h-6 w-12 ml-auto' /></TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-8 text-rose-500'>
                    Failed to load staff performance data.
                    <Button variant='link' onClick={() => refetch()} className='ml-2 text-xs'>
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-10 text-muted-foreground'>
                    No staff operational activity found for the selected period.
                  </TableCell>
                </TableRow>
              ) : (
                employees.map((row) => (
                  <TableRow key={row.employeeId} className='hover:bg-muted/30'>
                    <TableCell>
                      <div className='flex items-center gap-3'>
                        <Avatar className='h-8 w-8 rounded-lg'>
                          {row.avatar && <AvatarImage src={row.avatar} alt={row.name} />}
                          <AvatarFallback className='rounded-lg text-xs font-bold'>
                            {row.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className='min-w-0'>
                          <p className='text-xs font-semibold truncate'>{row.name}</p>
                          <p className='text-[10px] text-muted-foreground truncate'>
                            {row.employeeCode} {row.department ? `· ${row.department}` : ''}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className='text-center font-bold text-xs tabular-nums'>
                      {row.ordersHandled}
                    </TableCell>

                    {/* Confirmed */}
                    <TableCell className='text-center'>
                      <div className='flex flex-col items-center'>
                        <span className='font-semibold text-xs text-emerald-600 tabular-nums'>
                          {row.confirmationRate}%
                        </span>
                        <span className='text-[10px] text-muted-foreground tabular-nums'>
                          ({row.confirmed} / {row.ordersHandled})
                        </span>
                      </div>
                    </TableCell>

                    {/* Delivered */}
                    <TableCell className='text-center'>
                      <div className='flex flex-col items-center'>
                        <span className='font-semibold text-xs text-purple-600 tabular-nums'>
                          {row.deliveryRate}%
                        </span>
                        <span className='text-[10px] text-muted-foreground tabular-nums'>
                          ({row.delivered} / {row.confirmed})
                        </span>
                      </div>
                    </TableCell>

                    {/* Returned */}
                    <TableCell className='text-center'>
                      <div className='flex flex-col items-center'>
                        <span className='font-semibold text-xs text-rose-600 tabular-nums'>
                          {row.returnRate}%
                        </span>
                        <span className='text-[10px] text-muted-foreground tabular-nums'>
                          ({row.returned} / {row.delivered})
                        </span>
                      </div>
                    </TableCell>

                    {/* Cancelled */}
                    <TableCell className='text-center'>
                      <div className='flex flex-col items-center'>
                        <span className='font-semibold text-xs text-amber-600 tabular-nums'>
                          {row.cancellationRate}%
                        </span>
                        <span className='text-[10px] text-muted-foreground tabular-nums'>
                          ({row.cancelled} / {row.ordersHandled})
                        </span>
                      </div>
                    </TableCell>

                    {/* End-to-End */}
                    <TableCell className='text-center'>
                      <div className='flex flex-col items-center'>
                        <Badge variant='outline' className='text-[10px] font-bold tabular-nums'>
                          {row.endToEndDeliveryRate}%
                        </Badge>
                        <span className='text-[9px] text-muted-foreground tabular-nums mt-0.5'>
                          ({row.delivered} / {row.ordersHandled})
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className='text-right font-semibold text-xs tabular-nums'>
                      ৳{row.totalRevenue?.toLocaleString() ?? 0}
                    </TableCell>

                    <TableCell className='text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-7 w-7 p-0'
                        title='View Orders'
                        onClick={() => setDrilldownEmp({ id: row.employeeId, name: row.name })}
                      >
                        <ExternalLink className='h-3.5 w-3.5' />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className='flex items-center justify-between p-4 border-t'>
            <span className='text-xs text-muted-foreground'>
              Showing {employees.length} of {meta.total} operators
            </span>
            <div className='flex items-center gap-1'>
              <Button
                variant='outline'
                size='sm'
                className='h-8 w-8 p-0'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <Button
                variant='outline'
                size='sm'
                className='h-8 w-8 p-0'
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Drilldown Dialog */}
      {drilldownEmp && (
        <DrilldownDialog
          open={!!drilldownEmp}
          onOpenChange={(open) => !open && setDrilldownEmp(null)}
          employeeId={drilldownEmp.id}
          employeeName={drilldownEmp.name}
          from={from}
          to={to}
        />
      )}
    </div>
  )
}

function HeaderWithTooltip({
  label,
  formula,
  explanation,
}: {
  label: string
  formula: string
  explanation: string
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='inline-flex items-center gap-1 cursor-help justify-center'>
            <span>{label}</span>
            <HelpCircle className='h-3 w-3 text-muted-foreground/60' />
          </div>
        </TooltipTrigger>
        <TooltipContent className='max-w-xs text-xs'>
          <p className='font-bold'>{formula}</p>
          <p className='text-muted-foreground mt-0.5'>{explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
