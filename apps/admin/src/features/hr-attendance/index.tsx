import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { DailyOverview } from './components/daily-overview'
import { AttendanceTable } from './components/attendance-table'
import { AttendanceDialog } from './components/attendance-dialog'
import type { AttendanceStatus } from './api'

export function AttendancePage() {
  const [date, setDate] = useState<Date>(() => new Date())
  const [employeeId, setEmployeeId] = useState('')
  const [status, setStatus] = useState<AttendanceStatus | 'all'>('all')
  const [departmentId, setDepartmentId] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)

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
            Daily attendance records, overview, and per-employee history.
          </p>
        </div>

        <DailyOverview date={date} />

        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <CardTitle>Attendance Records</CardTitle>
                <CardDescription>Filter by date, employee, status, or department.</CardDescription>
              </div>
              <AttendanceDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                defaultDate={date}
                trigger={
                  <Button size='sm'>
                    <span className='mr-1'>+</span> Add Record
                  </Button>
                }
              />
            </div>
          </CardHeader>
          <CardContent>
            <AttendanceTable
              date={date}
              onDateChange={(d) => { setDate(d); resetPage() }}
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
      </Main>
    </>
  )
}