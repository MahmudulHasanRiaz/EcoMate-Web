import { useState, useRef, useEffect } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Briefcase,
  CalendarDays,
  Clock,
  TrendingUp,
  Wallet,
  User,
  Plus,
  RotateCcw,
  CheckCircle2,
  Building,
} from 'lucide-react'
import { useMyProfileQuery, useMyPerformanceQuery } from './hooks'
import { PerformanceTab } from './components/performance-tab'
import { LeaveTab } from './components/leave-tab'
import { AttendanceTab } from './components/attendance-tab'
import { CompensationTab } from './components/compensation-tab'
import { PersonalTab } from './components/personal-tab'

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  probation: { label: 'Probation', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
  suspended: { label: 'Suspended', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  resigned: { label: 'Resigned', className: 'bg-muted text-muted-foreground border-border' },
  terminated: { label: 'Terminated', className: 'bg-destructive/15 text-destructive border-destructive/30' },
}

export function MyProfilePage() {
  const { data: profile, isLoading: profileLoading, isError: profileError, refetch: refetchProfile } = useMyProfileQuery()
  const { data: performance, isLoading: perfLoading, refetch: refetchPerf } = useMyPerformanceQuery()

  const [activeTab, setActiveTab] = useState('performance')
  const [applyLeaveModalOpen, setApplyLeaveModalOpen] = useState(false)
  const tabListRef = useRef<HTMLDivElement>(null)

  // Keep active tab in view on mobile scroll
  useEffect(() => {
    const list = tabListRef.current
    const active = list?.querySelector<HTMLElement>('[data-state="active"]')
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeTab])

  if (profileLoading) {
    return (
      <>
        <Header fixed>
          <GlobalSearchBar className="me-auto" />
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>
        <Main className="flex flex-1 flex-col gap-4 sm:gap-6">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-2xl" />
        </Main>
      </>
    )
  }

  if (profileError || !profile) {
    return (
      <>
        <Header fixed>
          <GlobalSearchBar className="me-auto" />
          <ThemeSwitch />
          <ProfileDropdown />
        </Header>
        <Main className="flex flex-1 flex-col gap-4 sm:gap-6">
          <Card>
            <CardContent className="py-16 text-center">
              <h2 className="text-xl font-bold">No Employee Profile Found</h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                Your user account is not linked to an active employee record. If you are an employee, please contact your HR administrator.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => {
                  refetchProfile()
                  refetchPerf()
                }}
              >
                <RotateCcw className="h-4 w-4" /> Retry
              </Button>
            </CardContent>
          </Card>
        </Main>
      </>
    )
  }

  const displayName = profile.betterAuthUser?.name || profile.employeeId
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const statusCfg = STATUS_BADGE[profile.status] || {
    label: profile.status,
    className: 'bg-muted text-muted-foreground',
  }

  const netSalaryNum = Number(
    profile.salaryStructures?.[0]?.netSalary || profile.salary || 0
  )

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className="me-auto" />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className="flex flex-1 flex-col gap-5 sm:gap-6 pb-12">
        {/* Top Hero Banner */}
        <Card className="border-border/60 bg-linear-to-b from-card to-muted/20 shadow-xs overflow-hidden">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              {/* Identity & Avatar */}
              <div className="flex items-center gap-4 sm:gap-5">
                <Avatar className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl border-2 border-border/80 shadow-xs">
                  {profile.betterAuthUser?.image && (
                    <AvatarImage src={profile.betterAuthUser.image} alt={displayName} />
                  )}
                  <AvatarFallback className="rounded-2xl bg-primary-soft text-primary-ink font-bold text-xl sm:text-2xl">
                    {initials}
                  </AvatarFallback>
                </Avatar>

                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
                      {displayName}
                    </h1>
                    <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 font-semibold">
                      {profile.employeeId}
                    </Badge>
                  </div>

                  <p className="text-xs sm:text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-foreground">
                      {profile.designation?.name || 'Staff'}
                    </span>
                    <span>·</span>
                    <span>{profile.department?.name || 'General Operations'}</span>
                    {profile.reportingTo?.betterAuthUser?.name && (
                      <>
                        <span>·</span>
                        <span className="text-xs">
                          Reports to: <strong className="text-foreground">{profile.reportingTo.betterAuthUser.name}</strong>
                        </span>
                      </>
                    )}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <Badge variant="outline" className={`text-xs ${statusCfg.className}`}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> {statusCfg.label}
                    </Badge>
                    <Badge variant="secondary" className="text-xs capitalize">
                      {profile.employmentType.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Quick Header Actions */}
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  onClick={() => {
                    setActiveTab('leave')
                    setApplyLeaveModalOpen(true)
                  }}
                  size="sm"
                  className="gap-1.5 shadow-xs"
                >
                  <Plus className="h-4 w-4" /> Apply for Leave
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    refetchProfile()
                    refetchPerf()
                  }}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4 Top KPI Glance Cards */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/60 bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Order Delivery Rate</span>
                <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-600">
                  <TrendingUp className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold tracking-tight">
                  {performance?.orders.deliveryRate ?? 0}%
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {performance?.orders.deliveredOrders ?? 0} delivered of {performance?.orders.totalAssignedOrders ?? 0} orders
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Monthly Attendance</span>
                <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-600">
                  <Clock className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold tracking-tight">
                  {performance?.attendance.workedHours ?? 0}h
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {performance?.attendance.presentDays ?? 0} days present ({performance?.attendance.onTimeRate ?? 100}% on-time)
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Leaves Remaining</span>
                <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-600">
                  <CalendarDays className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold tracking-tight">
                  {performance?.leaves.totalRemaining ?? 0} days
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {performance?.leaves.pendingCount ?? 0} pending request(s)
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Net Monthly Salary</span>
                <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-600">
                  <Wallet className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2">
                <span className="text-2xl font-bold tracking-tight tabular-nums">
                  {netSalaryNum.toLocaleString()} ৳
                </span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Commission: +{Number(performance?.financial.monthCommission || 0).toLocaleString()} ৳ this month
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 5 Organized Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList
            ref={tabListRef}
            className="h-auto w-full justify-start flex-nowrap overflow-x-auto p-1 bg-muted/50 border border-border/50 rounded-xl"
          >
            <TabsTrigger value="performance" className="gap-2 text-xs sm:text-sm py-2">
              <TrendingUp className="h-4 w-4" /> Performance Overview
            </TabsTrigger>
            <TabsTrigger value="leave" className="gap-2 text-xs sm:text-sm py-2">
              <CalendarDays className="h-4 w-4" /> Leaves &amp; Applications
            </TabsTrigger>
            <TabsTrigger value="attendance" className="gap-2 text-xs sm:text-sm py-2">
              <Clock className="h-4 w-4" /> Attendance &amp; Log
            </TabsTrigger>
            <TabsTrigger value="compensation" className="gap-2 text-xs sm:text-sm py-2">
              <Wallet className="h-4 w-4" /> Salary &amp; Income
            </TabsTrigger>
            <TabsTrigger value="personal" className="gap-2 text-xs sm:text-sm py-2">
              <User className="h-4 w-4" /> Profile &amp; Details
            </TabsTrigger>
          </TabsList>

          <TabsContent value="performance">
            <PerformanceTab performance={performance} isLoading={perfLoading} />
          </TabsContent>

          <TabsContent value="leave">
            <LeaveTab
              openApplyModal={applyLeaveModalOpen}
              onOpenApplyModalChange={setApplyLeaveModalOpen}
            />
          </TabsContent>

          <TabsContent value="attendance">
            <AttendanceTab />
          </TabsContent>

          <TabsContent value="compensation">
            <CompensationTab profile={profile} />
          </TabsContent>

          <TabsContent value="personal">
            <PersonalTab profile={profile} />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
