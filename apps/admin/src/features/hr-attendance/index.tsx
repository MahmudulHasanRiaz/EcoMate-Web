import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAuthStore } from '@/stores/auth-store'
import { TodayState } from './components/today-state'
import { AttendanceTable } from './components/attendance-table'
import { DailyOverview } from './components/daily-overview'
import { AdjustmentsTab } from './components/adjustments-tab'
import { DevicesTab } from './components/devices-tab'
import { SettingsTab } from './components/settings-tab'
import { dhakaTodayDate, type AttendanceStatus } from './api'

const SUB_TABS = [
  { value: 'today', label: 'Today' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'adjustments', label: 'Adjustments' },
  { value: 'devices', label: 'Devices' },
  { value: 'settings', label: 'Settings' },
]

export function AttendancePage({ initialTab }: { initialTab?: string }) {
  const permissions = useAuthStore((s) => s.auth.user?.permissions) ?? []
  const canManageDevices = permissions.includes('manage_attendance_devices')

  const [tab, setTab] = useState(SUB_TABS.some((t) => t.value === initialTab) ? initialTab! : 'today')
  const [todayEmployeeId, setTodayEmployeeId] = useState('')
  const [date, setDate] = useState<Date>(() => dhakaTodayDate())
  const [employeeId, setEmployeeId] = useState('')
  const [status, setStatus] = useState<AttendanceStatus | 'all'>('all')
  const [departmentId, setDepartmentId] = useState('')
  const [page, setPage] = useState(1)

  function resetPage() {
    setPage(1)
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Attendance Management</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Live check-in state, daily records, adjustments, devices, and mode settings.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className='h-auto w-full flex-nowrap overflow-x-auto lg:w-auto lg:flex-wrap lg:overflow-visible'>
            {SUB_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value='today' className='space-y-4'>
            <TodayState employeeId={todayEmployeeId} onEmployeeIdChange={setTodayEmployeeId} />
          </TabsContent>

          <TabsContent value='calendar' className='space-y-4'>
            <DailyOverview date={date} />
            <Card>
              <CardHeader>
                <CardTitle>Attendance Records</CardTitle>
                <CardDescription>Filter by date, employee, status, or department.</CardDescription>
              </CardHeader>
              <CardContent>
                <AttendanceTable
                  date={date}
                  onDateChange={(d) => { if (d) setDate(d); resetPage() }}
                  employeeId={employeeId}
                  onEmployeeChange={(id) => { setEmployeeId(id); resetPage() }}
                  status={status}
                  onStatusChange={(s) => { setStatus(s); resetPage() }}
                  departmentId={departmentId}
                  onDepartmentChange={(id) => { setDepartmentId(id); resetPage() }}
                  page={page}
                  onPageChange={setPage}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value='adjustments' className='space-y-4'>
            <AdjustmentsTab />
          </TabsContent>

          <TabsContent value='devices' className='space-y-4'>
            {canManageDevices ? (
              <DevicesTab />
            ) : (
              <Card>
                <CardContent className='py-10 text-center text-sm text-muted-foreground'>
                  Devices require Manage Attendance Devices permission.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value='settings' className='space-y-4'>
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}