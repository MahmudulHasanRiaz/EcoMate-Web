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
import { AttendanceSummaryTab } from './components/attendance-summary-tab'

function getPresetDates(preset: string): { from: string; to: string } {
  const now = new Date()
  const toISO = (d: Date) => d.toISOString().split('T')[0]

  switch (preset) {
    case 'today':
      return { from: toISO(now), to: toISO(now) }
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { from: toISO(y), to: toISO(y) }
    }
    case 'this_week': {
      const start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      return { from: toISO(start), to: toISO(now) }
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: toISO(start), to: toISO(now) }
    }
    case 'last_30_days': {
      const start = new Date(now)
      start.setDate(now.getDate() - 30)
      return { from: toISO(start), to: toISO(now) }
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
