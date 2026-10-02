import {
  Users,
  UserCheck,
  Wallet,
  Clock,
  Banknote,
  BadgeDollarSign,
  CalendarClock,
  Coins,
  Building2,
  Coffee,
  UserX,
  AlertTriangle,
  CheckSquare,
  ShoppingBag,
  TrendingUp,
  AlertCircle,
  Truck,
  CheckCircle2,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { riseStyle, type KpiAccent } from '@/components/ui/dashboard'
import { cn } from '@/lib/utils'
import { useHrOverviewQuery } from './hooks'
import { Link } from '@tanstack/react-router'
import { formatDuration } from '@/features/hr-attendance/api'

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 0,
  }).format(value || 0)
}

function StatCard({
  icon: Icon,
  title,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType
  title: string
  value: string | number
  sub?: string
  accent: KpiAccent
}) {
  return (
    <Card className={cn('kpi-card', `kpi-accent-${accent}`)}>
      <CardContent className="p-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className="kpi-value mt-1.5 truncate" title={String(value)}>
            {value}
          </p>
          {sub ? (
            <p className="mt-1 text-xs text-muted-foreground truncate">{sub}</p>
          ) : null}
        </div>
        <span className="kpi-icon-badge shrink-0" aria-hidden>
          <Icon className="size-4.5" />
        </span>
      </CardContent>
    </Card>
  )
}

export function HrDashboard() {
  const { data, isLoading, isError, refetch } = useHrOverviewQuery()

  const att = data?.attendance
  const tasks = data?.tasks
  const orderOps = data?.orderOperations
  const exceptions = data?.exceptions

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Building2 className="size-5" />
          <h1 className="text-lg font-bold tracking-tight">HR Management</h1>
          <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Dashboard
          </span>
        </div>
      </Header>
      <Main className="flex flex-1 flex-col gap-4 sm:gap-6 pb-12">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">HR &amp; Operations Overview</h2>
            <p className="text-sm text-muted-foreground">
              Workforce presence, daily productivity, order operations, and compensation at a glance
            </p>
          </div>
          <Link
            to="/hr/performance"
            className="inline-flex items-center gap-1.5 rounded-xl border bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 text-xs font-semibold transition-colors duration-200"
          >
            <TrendingUp className="h-3.5 w-3.5" /> View Performance &amp; Reports
          </Link>
        </div>

        {isError ? (
          <Card className="chart-card rounded-2xl p-6 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load HR overview.
            </p>
            <button
              onClick={() => refetch()}
              className="tap-h rounded-xl border px-3 text-xs font-semibold transition-colors duration-200 hover:bg-muted"
            >
              Retry
            </button>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : data ? (
          <>
            {/* ── Operational Exceptions Alert Bar (if any action is needed) ── */}
            {exceptions &&
              (exceptions.missingCheckout > 0 ||
                exceptions.pendingLeaveRequests > 0 ||
                exceptions.overdueTasksTotal > 0) && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 animate-rise flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="p-2 rounded-xl bg-amber-500/20 text-amber-600">
                      <AlertTriangle className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-amber-700 dark:text-amber-400">
                        Operational Attention Required
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {exceptions.missingCheckout > 0 && `${exceptions.missingCheckout} missing checkout(s) from yesterday · `}
                        {exceptions.pendingLeaveRequests > 0 && `${exceptions.pendingLeaveRequests} pending leave request(s) · `}
                        {exceptions.overdueTasksTotal > 0 && `${exceptions.overdueTasksTotal} overdue task(s)`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {exceptions.missingCheckout > 0 && (
                      <Link
                        to="/hr/attendance"
                        className="rounded-lg bg-background px-2.5 py-1 text-xs font-semibold border shadow-xs"
                      >
                        Resolve Attendance
                      </Link>
                    )}
                    {exceptions.pendingLeaveRequests > 0 && (
                      <Link
                        to="/hr/leave"
                        className="rounded-lg bg-background px-2.5 py-1 text-xs font-semibold border shadow-xs"
                      >
                        Review Leaves
                      </Link>
                    )}
                  </div>
                </div>
              )}

            {/* ── 1. Workforce Today ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Workforce Today ({att?.date || 'Live'})
                </h3>
                <Link to="/hr/attendance" className="text-xs text-primary font-medium hover:underline">
                  Full Attendance &rarr;
                </Link>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 animate-rise" style={riseStyle(0)}>
                <StatCard
                  icon={Users}
                  title="Total Staff"
                  value={data.employees.total}
                  sub={`${data.employees.active} active`}
                  accent="info"
                />
                <StatCard
                  icon={UserCheck}
                  title="Present"
                  value={att?.present ?? 0}
                  sub="checked-in today"
                  accent="success"
                />
                <StatCard
                  icon={Clock}
                  title="Working Now"
                  value={att?.currentlyWorking ?? 0}
                  sub="active sessions"
                  accent="success"
                />
                <StatCard
                  icon={Coffee}
                  title="On Break"
                  value={att?.onBreak ?? 0}
                  sub="paused / lunch"
                  accent="cyan"
                />
                <StatCard
                  icon={UserX}
                  title="Absent"
                  value={att?.absent ?? 0}
                  accent="danger"
                />
                <StatCard
                  icon={CalendarClock}
                  title="On Leave"
                  value={att?.onLeave ?? data.employees.on_leave}
                  accent="warning"
                />
                <StatCard
                  icon={AlertCircle}
                  title="Late"
                  value={att?.late ?? 0}
                  accent="warning"
                />
                <StatCard
                  icon={AlertTriangle}
                  title="Missing Checkout"
                  value={att?.missingCheckout ?? 0}
                  accent="danger"
                />
              </div>
            </div>

            {/* ── 2. Time Worked, Tasks & Order Operations ── */}
            <div className="grid gap-4 lg:grid-cols-3 animate-rise" style={riseStyle(1)}>
              {/* Daily Time Summary */}
              <Card className="chart-card rounded-2xl">
                <CardHeader className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
                      <Clock className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-base">Time Tracked Today</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Total Worked Time</span>
                    <span className="text-base font-bold tabular-nums text-foreground">
                      {formatDuration(att?.workedMinutes ?? 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Total Break Time</span>
                    <span className="text-base font-bold tabular-nums text-muted-foreground">
                      {formatDuration(att?.breakMinutes ?? 0)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Overtime Recorded</span>
                    <span className="text-base font-bold tabular-nums text-amber-600">
                      {formatDuration(att?.overtimeMinutes ?? 0)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Task Productivity */}
              <Card className="chart-card rounded-2xl">
                <CardHeader className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <span className="chart-card-header-icon bg-purple-soft text-purple border border-purple/25">
                      <CheckSquare className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-base">Task Productivity</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Created Today</span>
                    <span className="text-base font-bold tabular-nums">{tasks?.createdToday ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Completed Today</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base font-bold tabular-nums text-emerald-600">
                        {tasks?.completedToday ?? 0}
                      </span>
                      {tasks && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ({tasks.completionRateToday}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Total Pending Tasks</span>
                    <span className="text-base font-bold tabular-nums text-amber-600">
                      {tasks?.pendingTotal ?? 0}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Order Operations Conversion */}
              <Card className="chart-card rounded-2xl">
                <CardHeader className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
                      <ShoppingBag className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-base">Order Operations ({orderOps?.periodLabel || 'Month'})</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Orders Handled</span>
                    <span className="text-base font-bold tabular-nums">{orderOps?.handled ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Confirmed</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base font-bold tabular-nums text-emerald-600">
                        {orderOps?.confirmed ?? 0}
                      </span>
                      {orderOps && (
                        <span className="text-xs font-semibold text-emerald-600 tabular-nums">
                          ({orderOps.confirmationRate}%)
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
                    <span className="text-xs font-medium text-muted-foreground">Delivered / Handled</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-base font-bold tabular-nums text-purple-600">
                        {orderOps?.delivered ?? 0}
                      </span>
                      {orderOps && (
                        <span className="text-xs font-semibold text-purple-600 tabular-nums">
                          ({orderOps.deliveryRateFromConfirmed}% from conf)
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── 3. Payroll & Compensation Overview ── */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Compensation &amp; Payroll
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-rise" style={riseStyle(2)}>
                <StatCard
                  icon={Wallet}
                  title="Payroll Last Period"
                  value={money(data.payroll.lastPeriodNet)}
                  sub={data.payroll.lastPeriodKey ?? 'No paid period yet'}
                  accent="violet"
                />
                <StatCard
                  icon={Clock}
                  title="Pending Approvals"
                  value={data.payroll.pendingApprovals}
                  sub="payslips in draft/review"
                  accent="warning"
                />
                <StatCard
                  icon={Banknote}
                  title="Paid This Month"
                  value={money(data.payroll.paidThisMonth)}
                  accent="success"
                />
                <StatCard
                  icon={BadgeDollarSign}
                  title="Payroll Payable"
                  value={money(data.payroll.payable)}
                  sub="approved, awaiting payment"
                  accent="warning"
                />
              </div>
            </div>

            {/* ── 4. Recent Payments Table & Quick Breakdown ── */}
            <div className="grid gap-4 lg:grid-cols-3 animate-rise" style={riseStyle(3)}>
              <Card className="chart-card rounded-2xl lg:col-span-2">
                <CardHeader className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
                      <Banknote className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-base">Recent Payments</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-2">
                  {data.recentPayments.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No payments recorded yet.
                    </p>
                  ) : (
                    data.recentPayments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2 transition-colors duration-200 hover:bg-muted/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {p.employeeName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {p.employeeId} · {p.periodKey ?? '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tabular-nums">
                            {money(p.netPay)}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {new Date(p.paidAt).toLocaleDateString()}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="chart-card rounded-2xl">
                <CardHeader className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
                      <Users className="h-4 w-4" />
                    </span>
                    <CardTitle className="text-base">Workforce Status</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground">Active Employees</span>
                    <span className="font-bold tabular-nums text-emerald-600">
                      {data.employees.active}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground">Terminated</span>
                    <span className="font-bold tabular-nums">
                      {data.employees.terminated}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground">Resigned</span>
                    <span className="font-bold tabular-nums">
                      {data.employees.resigned}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
                    <span className="text-muted-foreground">Inactive / Suspended</span>
                    <span className="font-bold tabular-nums">
                      {data.employees.inactive + data.employees.suspended}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </Main>
    </>
  )
}