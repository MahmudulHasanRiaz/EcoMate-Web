import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useLeaveTypesQuery,
  useDeleteTypeMutation,
  useLeaveRequestsQuery,
  useRejectRequestMutation,
} from './hooks'
import { LeaveTypeDialog } from './components/leave-type-dialog'
import { LeaveRequestDialog } from './components/leave-request-dialog'
import { LeaveRequestTable } from './components/leave-request-table'
import { LeaveBalanceTable } from './components/leave-balance-table'
import { LeaveCalendar } from './components/leave-calendar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useQuery } from '@tanstack/react-query'
import { employeesApi, type EmployeeResponse } from '@/features/employees/api'
import type { LeaveRequest, LeaveStatus, LeaveType } from './api'

const TYPE_PAID_BADGE = 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'

function TypesTab() {
  const { data: types, isLoading, isError, refetch } = useLeaveTypesQuery({})
  const deleteMut = useDeleteTypeMutation()
  const [deleteTarget, setDeleteTarget] = useState<LeaveType | null>(null)
  const rows: LeaveType[] = Array.isArray(types) ? types : []

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Leave Types</CardTitle>
            <CardDescription>Define paid and unpaid leave categories.</CardDescription>
          </div>
          <LeaveTypeDialog />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6 text-muted-foreground' /></div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load leave types.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>No leave types yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className='text-right'>Days/Year</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className='w-32'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className='font-medium'>{t.name}</TableCell>
                  <TableCell className='font-mono text-xs'>{t.code}</TableCell>
                  <TableCell className='text-right tabular-nums'>{t.daysPerYear}</TableCell>
                  <TableCell>
                    {t.isPaid ? (
                      <Badge className={`border-transparent ${TYPE_PAID_BADGE}`}>Paid</Badge>
                    ) : (
                      <Badge variant='outline'>Unpaid</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.isActive ? 'default' : 'secondary'}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-1'>
                      <LeaveTypeDialog type={t} />
                      <Button variant='ghost' size='sm' className='text-rose-600' onClick={() => setDeleteTarget(t)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title='Delete Leave Type'
        desc={`Delete "${deleteTarget?.name}" (${deleteTarget?.code})? This cannot be undone.`}
        confirmText='Delete'
        destructive
        isLoading={deleteMut.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })
        }}
      />
    </Card>
  )
}

function RequestsTab() {
  const [employeeId, setEmployeeId] = useState('')
  const [status, setStatus] = useState<LeaveStatus | 'all'>('all')
  const [page, setPage] = useState(1)

  const { data: employees } = useQuery({
    queryKey: ['employees', 'leave-filter-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })

  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const rejectMut = useRejectRequestMutation()
  const now = new Date()

  function submitReject() {
    if (!rejectTarget) return
    if (!rejectNote.trim()) return
    rejectMut.mutate(
      { id: rejectTarget.id, decisionNote: rejectNote.trim() },
      { onSuccess: () => { setRejectTarget(null); setRejectNote('') } },
    )
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <CardTitle>Leave Requests</CardTitle>
              <CardDescription>Review and manage employee leave requests.</CardDescription>
            </div>
            <LeaveRequestDialog />
          </div>
        </CardHeader>
        <CardContent>
          <div className='mb-4 grid gap-3 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label>Employee (optional)</Label>
              <Select value={employeeId || 'all'} onValueChange={(v) => { setEmployeeId(v === 'all' ? '' : v); setPage(1) }}>
                <SelectTrigger><SelectValue placeholder='All employees' /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All employees</SelectItem>
                  {(employees || []).map((e: EmployeeResponse) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.employeeId} · {e.betterAuthUser?.name || '—'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => { setStatus(v as LeaveStatus | 'all'); setPage(1) }}>
                <SelectTrigger><SelectValue placeholder='All statuses' /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All statuses</SelectItem>
                  <SelectItem value='pending'>Pending</SelectItem>
                  <SelectItem value='approved'>Approved</SelectItem>
                  <SelectItem value='rejected'>Rejected</SelectItem>
                  <SelectItem value='cancelled'>Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <LeaveRequestTable
            employeeId={employeeId || undefined}
            status={status === 'all' ? undefined : (status as LeaveStatus)}
            page={page}
            onPageChange={setPage}
            onReject={setRejectTarget}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
          <CardDescription>Approved leaves for the selected employee this month.</CardDescription>
        </CardHeader>
        <CardContent>
          <LeaveCalendar
            employeeId={employeeId || undefined}
            year={now.getFullYear()}
            month={now.getMonth() + 1}
          />
        </CardContent>
      </Card>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null) }}>
        <DialogContent className='sm:max-w-[480px]'>
          <DialogHeader>
            <DialogTitle>Reject Leave Request</DialogTitle>
          </DialogHeader>
          <div className='grid gap-2 py-4'>
            <Label>Decision Note (required)</Label>
            <textarea
              className='min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder='Reason for rejection'
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button
              variant='destructive'
              disabled={rejectMut.isPending || !rejectNote.trim()}
              onClick={submitReject}
            >
              {rejectMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BalancesTab() {
  const [employeeId, setEmployeeId] = useState('')
  const { data: employees } = useQuery({
    queryKey: ['employees', 'leave-balance-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Leave Balances</CardTitle>
            <CardDescription>Remaining entitlement per leave type.</CardDescription>
          </div>
          <div className='w-72'>
            <Select value={employeeId || ''} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder='Select employee' /></SelectTrigger>
              <SelectContent>
                {(employees || []).map((e: EmployeeResponse) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.employeeId} · {e.betterAuthUser?.name || '—'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <LeaveBalanceTable employeeId={employeeId || undefined} />
      </CardContent>
    </Card>
  )
}

export function LeaveTab({ employeeId }: { employeeId: string }) {
  const [page, setPage] = useState(1)
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const rejectMut = useRejectRequestMutation()
  const now = new Date()

  function submitReject() {
    if (!rejectTarget) return
    if (!rejectNote.trim()) return
    rejectMut.mutate(
      { id: rejectTarget.id, decisionNote: rejectNote.trim() },
      { onSuccess: () => { setRejectTarget(null); setRejectNote('') } },
    )
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>Leave Balances</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveBalanceTable employeeId={employeeId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <CardTitle>Leave Requests</CardTitle>
            <LeaveRequestDialog defaultEmployeeId={employeeId} />
          </div>
        </CardHeader>
        <CardContent>
          <LeaveRequestTable
            employeeId={employeeId}
            page={page}
            onPageChange={setPage}
            onReject={setRejectTarget}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leave Calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <LeaveCalendar employeeId={employeeId} year={now.getFullYear()} month={now.getMonth() + 1} />
        </CardContent>
      </Card>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) setRejectTarget(null) }}>
        <DialogContent className='sm:max-w-[480px]'>
          <DialogHeader>
            <DialogTitle>Reject Leave Request</DialogTitle>
          </DialogHeader>
          <div className='grid gap-2 py-4'>
            <Label>Decision Note (required)</Label>
            <textarea
              className='min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder='Reason for rejection'
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button
              variant='destructive'
              disabled={rejectMut.isPending || !rejectNote.trim()}
              onClick={submitReject}
            >
              {rejectMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function LeavePage() {
  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Leave Management</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Configure leave types, process requests, and track balances.
          </p>
        </div>

        <Tabs defaultValue='types'>
          <TabsList className='h-auto flex-wrap'>
            <TabsTrigger value='types'>Types</TabsTrigger>
            <TabsTrigger value='requests'>Requests</TabsTrigger>
            <TabsTrigger value='balances'>Balances</TabsTrigger>
          </TabsList>

          <TabsContent value='types' className='space-y-4'>
            <TypesTab />
          </TabsContent>
          <TabsContent value='requests' className='space-y-4'>
            <RequestsTab />
          </TabsContent>
          <TabsContent value='balances' className='space-y-4'>
            <BalancesTab />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
