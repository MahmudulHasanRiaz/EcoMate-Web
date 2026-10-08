import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TrendingUp,
  ShoppingBag,
  CheckSquare,
  CalendarCheck,
  Calendar,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '@/features/employees/api'
import { useDepartmentsQuery } from '@/features/departments/hooks'
import { OrderPerformanceTab } from './components/order-performance-tab'
import { TaskProductivityTab } from './components/task-productivity-tab'
import { toDhakaDateString } from '@/lib/dhaka-time'
import { AttendanceSummaryTab } from './components/attendance-summary-tab'

/**
 * Preset ranges are business dates, so they must be stamped with the Dhaka
 * calendar day. Using the browser's UTC day instead was wrong for 6 hours out
 * of every 24: between 00:00 and 06:00 Dhaka the UTC date is still yesterday,
 * so "Today" silently reported a full day behind, and "This Month"
 * resolved to the last day of the previous month.
 *
 * The business week starts Saturday, matching the weekly-off convention used by
 * the attendance shift rotation. (The previous code subtracted getDay() alone,
 * which starts the week on Sunday.)
 */
export function getPresetDates(preset: string): { from: string; to: string } {
  const now = new Date()
  const dk = (d: Date) => toDhakaDateString(d)
  const shiftDays = (days: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    return d
  }
  // Calendar fields MUST come from the Dhaka wall clock, never the host.
  // getDay()/getMonth()/getFullYear() read the host timezone (UTC on CI), but
  // business dates are Dhaka: between 00:00 and 06:00 Dhaka the host UTC day
  // is still yesterday, so host-based math lands the week start on Sunday
  // (and the month start in the previous month). Dhaka has a fixed +6h offset
  // with no DST, so shifting the instant and reading UTC fields IS the Dhaka
  // calendar.
  const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000
  const dhakaWall = new Date(now.getTime() + DHAKA_OFFSET_MS)

  switch (preset) {
    case 'today':
      return { from: dk(now), to: dk(now) }
    case 'yesterday': {
      const y = shiftDays(-1)
      return { from: dk(y), to: dk(y) }
    }
    case 'this_week': {
      // Saturday is 6 and Sunday is 0, so (day + 1) % 7 maps both to a
      // zero-day offset. Weekday read from the Dhaka wall clock (see above);
      // instant arithmetic (Dhaka days are exactly 24h, no DST) keeps this
      // independent of host-timezone DST steps.
      const offsetDays = (dhakaWall.getUTCDay() + 1) % 7
      const start = new Date(now.getTime() - offsetDays * 86400000)
      return { from: dk(start), to: dk(now) }
    }
    case 'this_month': {
      // Month start in the Dhaka calendar: UTC-midnight of the Dhaka 1st is
      // 06:00 Dhaka the same day, so it formats back to the 1st exactly.
      const start = new Date(Date.UTC(dhakaWall.getUTCFullYear(), dhakaWall.getUTCMonth(), 1))
      return { from: dk(start), to: dk(now) }
    }
    case 'last_30_days': {
      const start = shiftDays(-30)
      return { from: dk(start), to: dk(now) }
    }
    default:
      return { from: '', to: '' }
  }
}

export function HrPerformancePage() {
  const [tab, setTab] = useState<'orders' | 'tasks' | 'attendance'>('orders')
  const [preset, setPreset] = useState<string>('this_month')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [departmentId, setDepartmentId] = useState<string>('all')
  const [employeeId, setEmployeeId] = useState<string>('all')

  const { data: deptResponse } = useDepartmentsQuery()
  const departments = deptResponse?.data || []

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', 'performance-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((res) => res.data.data),
  })

  const activeDates =
    preset === 'custom'
      ? { from: customFrom, to: customTo }
      : getPresetDates(preset)

  const activeDept = departmentId === 'all' ? undefined : departmentId
  const activeEmp = employeeId === 'all' ? undefined : employeeId

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6 pb-12'>
        {/* Title & Banner */}
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <div className='flex items-center gap-2'>
              <TrendingUp className='h-6 w-6 text-primary' />
              <h1 className='text-2xl font-bold tracking-tight'>HR &amp; Staff Performance</h1>
            </div>
            <p className='text-xs text-muted-foreground mt-0.5'>
              Workforce productivity, task time tracking, and e-commerce order conversion funnels
            </p>
          </div>
        </div>

        {/* Global Filter Bar */}
        <div className='flex flex-wrap items-center gap-3 p-4 rounded-xl border border-border/60 bg-card'>
          {/* Preset Buttons */}
          <div className='flex items-center gap-1 overflow-x-auto'>
            {[
              { id: 'today', label: 'Today' },
              { id: 'yesterday', label: 'Yesterday' },
              { id: 'this_week', label: 'This Week' },
              { id: 'this_month', label: 'This Month' },
              { id: 'last_30_days', label: 'Last 30 Days' },
              { id: 'custom', label: 'Custom' },
            ].map((p) => (
              <Button
                key={p.id}
                variant={preset === p.id ? 'default' : 'ghost'}
                size='sm'
                className='h-8 text-xs font-medium'
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Custom Date Pickers */}
          {preset === 'custom' && (
            <div className='flex items-center gap-2'>
              <input
                type='date'
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className='h-8 px-2 text-xs rounded-md border border-input bg-background'
                placeholder='From'
              />
              <span className='text-xs text-muted-foreground'>to</span>
              <input
                type='date'
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className='h-8 px-2 text-xs rounded-md border border-input bg-background'
                placeholder='To'
              />
            </div>
          )}

          {/* Department Filter */}
          <div className='w-44'>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className='h-8 text-xs'>
                <SelectValue placeholder='Department: All' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Departments</SelectItem>
                {departments.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Employee Filter */}
          <div className='w-48'>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className='h-8 text-xs'>
                <SelectValue placeholder='Employee: All' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Employees</SelectItem>
                {employees.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.betterAuthUser?.name || e.employeeId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reset button */}
          {(departmentId !== 'all' || employeeId !== 'all' || preset !== 'this_month') && (
            <Button
              variant='outline'
              size='sm'
              className='h-8 text-xs'
              onClick={() => {
                setPreset('this_month')
                setDepartmentId('all')
                setEmployeeId('all')
              }}
            >
              Reset
            </Button>
          )}
        </div>

        {/* Domain Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className='space-y-4'>
          <TabsList className='grid grid-cols-3 w-full max-w-md'>
            <TabsTrigger value='orders' className='gap-2 text-xs font-semibold'>
              <ShoppingBag className='h-4 w-4' /> Order Funnel
            </TabsTrigger>
            <TabsTrigger value='tasks' className='gap-2 text-xs font-semibold'>
              <CheckSquare className='h-4 w-4' /> Task Productivity
            </TabsTrigger>
            <TabsTrigger value='attendance' className='gap-2 text-xs font-semibold'>
              <CalendarCheck className='h-4 w-4' /> Attendance Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value='orders' className='space-y-4'>
            <OrderPerformanceTab
              from={activeDates.from}
              to={activeDates.to}
              departmentId={activeDept}
              employeeId={activeEmp}
            />
          </TabsContent>

          <TabsContent value='tasks' className='space-y-4'>
            <TaskProductivityTab
              from={activeDates.from}
              to={activeDates.to}
              departmentId={activeDept}
              employeeId={activeEmp}
            />
          </TabsContent>

          <TabsContent value='attendance' className='space-y-4'>
            <AttendanceSummaryTab
              from={activeDates.from}
              to={activeDates.to}
              departmentId={activeDept}
              employeeId={activeEmp}
            />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
