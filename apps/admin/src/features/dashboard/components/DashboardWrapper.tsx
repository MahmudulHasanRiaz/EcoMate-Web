'use client'

import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { useDateFilter } from '../use-date-filter'
import { DateFilter } from './DateFilter'
import { ViewSwitch } from './ViewSwitch'
import { DashboardGrid } from './DashboardGrid'
import { monWidgets } from '../config/mon-widgets'
import { opWidgets } from '../config/op-widgets'
import { LayoutGrid } from 'lucide-react'
import { riseStyle } from '@/components/ui/dashboard'
import { canAccess } from '../constants'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import type { RoleKey } from '../types'

// Import widgets for custom Operations layout
import { OperationalKpiStrip } from '../widgets/OperationalKpiStrip'
import { PendingOrders } from '../widgets/PendingOrders'
import { RecentOrders } from '../widgets/RecentOrders'
import { SystemAlerts } from '../widgets/SystemAlerts'
import { ActivityLog } from '../widgets/ActivityLog'
import { LowStockAlert } from '../widgets/LowStockAlert'

interface DashboardWrapperProps {
  route: 'mon' | 'op'
}

export function DashboardWrapper({ route }: DashboardWrapperProps) {
  const { preset, dateRange, view, setView } = useDateFilter()
  const userRole = (useAuthStore(s => s.auth.user?.role) || 'cashier') as RoleKey

  const configs = useMemo(() => {
    const all = route === 'mon' ? monWidgets : opWidgets
    return all.filter(cfg => canAccess(userRole, cfg.minRole))
  }, [route, userRole])

  return (
    <>
      <Header>
        <GlobalSearchBar className="me-auto" />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      
      {route === 'mon' ? (
        <Main>
          <div className="mb-4 flex flex-col flex-wrap sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
                <LayoutGrid className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Management Dashboard</h1>
                <p className="text-xs text-muted-foreground font-medium">
                  Now · what needs attention — trends, profit and comparisons live in{' '}
                  <Link to="/mon/analytics" className="underline underline-offset-2">
                    Analytics
                  </Link>
                  .
                </p>
              </div>
            </div>
            <DateFilter />
          </div>
          <DashboardGrid
            configs={configs}
            widgetProps={{ dateRange, preset, userRole }}
          />
        </Main>
      ) : (
        <Main className="space-y-4 sm:space-y-6">
          {/* Header section (Sticky) */}
          <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-4 border-b border-border/50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-3">
                <span className="chart-card-header-icon bg-info-soft text-info border border-info/25">
                  <LayoutGrid className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight">Operations Dashboard</h1>
                  <p className="text-xs text-muted-foreground font-medium">
                    {view === 'pipeline'
                      ? 'Where orders created in the selected period stand now'
                      : 'What happened in the selected period'}
                  </p>
                </div>
              </div>
              <div className="flex flex-col flex-wrap sm:flex-row sm:items-center gap-2">
                <ViewSwitch view={view} onChange={setView} />
                <DateFilter />
              </div>
            </div>
          </div>

          {/* Level 1: Executive KPI Overview */}
          <OperationalKpiStrip
            dateRange={dateRange}
            preset={preset}
            userRole={userRole}
            isLoading={false}
            view={view}
          />

          {/* Level 2: Main Workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
            {/* Left 70% Column */}
            <div className="lg:col-span-7 space-y-6 animate-rise" style={riseStyle(1)}>
              <PendingOrders
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
                view={view}
              />
              <RecentOrders
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
                view={view}
              />
            </div>

            {/* Right 30% Column */}
            <div className="lg:col-span-3 space-y-6 animate-rise" style={riseStyle(2)}>
              <SystemAlerts
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
                view={view}
              />
              <ActivityLog
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
                view={view}
              />
              <LowStockAlert
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
                view={view}
              />
            </div>
          </div>
        </Main>
      )}
    </>
  )
}

