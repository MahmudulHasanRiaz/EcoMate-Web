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
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useHrOverviewQuery } from './hooks'

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
  tint,
}: {
  icon: React.ElementType
  title: string
  value: string | number
  sub?: string
  tint: string
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums truncate">
            {value}
          </p>
          {sub ? (
            <p className="mt-1 text-xs text-muted-foreground truncate">{sub}</p>
          ) : null}
        </div>
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>
          <Icon className="size-4.5" />
        </div>
      </CardContent>
    </Card>
  )
}

export function HrDashboard() {
  const { data, isLoading, isError, refetch } = useHrOverviewQuery()

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
      <Main className="flex flex-1 flex-col gap-4 sm:gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">HR Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            People, payroll and compensation at a glance
          </p>
        </div>

        {isError ? (
          <Card className="p-6 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load HR overview.
            </p>
            <button
              onClick={() => refetch()}
              className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              Retry
            </button>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={Users}
                title="Total Employees"
                value={data.employees.total}
                sub={`${data.employees.active} active`}
                tint="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              />
              <StatCard
                icon={UserCheck}
                title="Active"
                value={data.employees.active}
                sub={`${data.employees.on_leave} on leave · ${data.employees.suspended} suspended`}
                tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              />
              <StatCard
                icon={Wallet}
                title="Payroll Last Period"
                value={money(data.payroll.lastPeriodNet)}
                sub={data.payroll.lastPeriodKey ?? 'No paid period yet'}
                tint="bg-violet-500/10 text-violet-600 dark:text-violet-400"
              />
              <StatCard
                icon={Clock}
                title="Pending Approvals"
                value={data.payroll.pendingApprovals}
                sub="payslips in draft/review"
                tint="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              />
              <StatCard
                icon={Banknote}
                title="Paid This Month"
                value={money(data.payroll.paidThisMonth)}
                tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              />
              <StatCard
                icon={BadgeDollarSign}
                title="Payroll Payable"
                value={money(data.payroll.payable)}
                sub="approved, awaiting payment"
                tint="bg-orange-500/10 text-orange-600 dark:text-orange-400"
              />
              <StatCard
                icon={Coins}
                title="Commission This Month"
                value={money(data.commissionThisMonth)}
                tint="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
              />
              <StatCard
                icon={CalendarClock}
                title="Pending Leave"
                value={data.queues.pendingLeaveRequests}
                sub="requests awaiting approval"
                tint="bg-rose-500/10 text-rose-600 dark:text-rose-400"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="px-5 py-4">
                  <CardTitle className="text-base">Recent Payments</CardTitle>
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
                        className="flex items-center justify-between rounded-md border px-3 py-2"
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

              <Card>
                <CardHeader className="px-5 py-4">
                  <CardTitle className="text-base">Quick View</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">Terminated</span>
                    <span className="font-bold tabular-nums">
                      {data.employees.terminated}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">Resigned</span>
                    <span className="font-bold tabular-nums">
                      {data.employees.resigned}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">Inactive</span>
                    <span className="font-bold tabular-nums">
                      {data.employees.inactive}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-muted-foreground">
                      Pending leave requests
                    </span>
                    <span className="font-bold tabular-nums">
                      {data.queues.pendingLeaveRequests}
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