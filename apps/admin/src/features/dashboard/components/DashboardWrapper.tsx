'use client'

import { useMemo } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useDateFilter } from '../use-date-filter'
import { DateFilter } from './DateFilter'
import { DashboardGrid } from './DashboardGrid'
import { monWidgets } from '../config/mon-widgets'
import { opWidgets } from '../config/op-widgets'
import { canAccess } from '../constants'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import type { RoleKey } from '../types'

// Import widgets for custom Operations layout
import { TodayKpiRow } from '../widgets/TodayKpiRow'
import { PendingOrders } from '../widgets/PendingOrders'
import { RecentOrders } from '../widgets/RecentOrders'
import { SystemAlerts } from '../widgets/SystemAlerts'
import { ActivityLog } from '../widgets/ActivityLog'
import { LowStockAlert } from '../widgets/LowStockAlert'

interface DashboardWrapperProps {
  route: 'mon' | 'op'
}

export function DashboardWrapper({ route }: DashboardWrapperProps) {
  const { preset, dateRange } = useDateFilter()
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
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Management Dashboard</h1>
            <DateFilter />
          </div>
          <DashboardGrid
            configs={configs}
            widgetProps={{ dateRange, preset, userRole }}
          />
        </Main>
      ) : (
        <Main className="space-y-6">
          {/* Header section (Sticky) */}
          <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pb-4 border-b border-border/50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">Operations Dashboard</h1>
                <p className="text-xs text-muted-foreground font-medium">Business Summary</p>
              </div>
              <DateFilter />
            </div>
          </div>

          {/* Level 1: Executive KPI Overview */}
          <TodayKpiRow
            dateRange={dateRange}
            preset={preset}
            userRole={userRole}
            isLoading={false}
          />

          {/* Level 2: Main Workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
            {/* Left 70% Column */}
            <div className="lg:col-span-7 space-y-6">
              <PendingOrders
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
              />
              <RecentOrders
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
              />
            </div>
            
            {/* Right 30% Column */}
            <div className="lg:col-span-3 space-y-6">
              <SystemAlerts
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
              />
              <ActivityLog
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
              />
              <LowStockAlert
                dateRange={dateRange}
                preset={preset}
                userRole={userRole}
                isLoading={false}
              />
            </div>
          </div>
        </Main>
      )}
    </>
  )
}

