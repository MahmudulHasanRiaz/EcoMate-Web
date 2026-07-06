import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { employeesApi, type EmployeeResponse, type EmploymentType, type EmployeeStatus } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'

const STATUS_BADGE: Record<EmployeeStatus, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  terminated: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  resigned: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

const EMPLOYMENT_TYPE_BADGE: Record<EmploymentType, string> = {
  full_time: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  part_time: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  contract: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  internship: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
}

const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  internship: 'Internship',
}

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  terminated: 'Terminated',
  resigned: 'Resigned',
}

function formatCurrency(amount: number | null | undefined) {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function Employees() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [perPage] = useState(10)
  const [statusFilter, setStatusFilter] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeResponse | null>(null)
  const [editForm, setEditForm] = useState({
    employmentType: '' as EmploymentType | '',
    status: '' as EmployeeStatus | '',
    salary: '',
    bankAccountNo: '',
    bankName: '',
    notes: '',
  })
  const [deleteTarget, setDeleteTarget] = useState<EmployeeResponse | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['employees', page, perPage, statusFilter],
    queryFn: () => employeesApi.list({ page, perPage, status: statusFilter || undefined }).then(r => r.data),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: any }) => employeesApi.update(id, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setEditOpen(false)
      setEditing(null)
      toast.success('Employee updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating employee'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => employeesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setDeleteTarget(null)
      toast.success('Employee deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting employee'),
  })

  function openEdit(employee: EmployeeResponse) {
    setEditing(employee)
    setEditForm({
      employmentType: employee.employmentType,
      status: employee.status,
      salary: employee.salary != null ? String(employee.salary) : '',
      bankAccountNo: employee.bankAccountNo || '',
      bankName: employee.bankName || '',
      notes: employee.notes || '',
    })
    setEditOpen(true)
  }

  function handleSave() {
    if (!editing) return
    updateMut.mutate({
      id: editing.id,
      d: {
        employmentType: editForm.employmentType || undefined,
        status: editForm.status || undefined,
        salary: editForm.salary ? parseFloat(editForm.salary) : undefined,
        bankAccountNo: editForm.bankAccountNo || undefined,
        bankName: editForm.bankName || undefined,
        notes: editForm.notes || undefined,
      },
    })
  }

  const listData = data?.data || []
  const totalPages = data?.meta?.totalPages || 1

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Employees</h2>
            <p className='text-muted-foreground'>Manage organization employees.</p>
          </div>
          <Button size='sm' onClick={() => navigate({ to: '/op/employees/create' })}>
            <Plus className='h-4 w-4 mr-1' /> Add Employee
          </Button>
        </div>

        <div className='flex gap-2'>
          {['', 'active', 'inactive', 'terminated', 'resigned'].map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size='sm'
              onClick={() => { setStatusFilter(s); setPage(1) }}
            >
              {s ? STATUS_LABELS[s as EmployeeStatus] : 'All'}
            </Button>
          ))}
        </div>

        <Card>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Designation</TableHead>
                  <TableHead>Access Preset</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Salary</TableHead>
                  <TableHead className='w-[80px]'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className='text-center py-8'>
                      <Loader2 className='animate-spin h-6 w-6 mx-auto text-muted-foreground' />
                    </TableCell>
                  </TableRow>
                ) : listData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className='text-center py-8 text-muted-foreground'>
                      No employees found
                    </TableCell>
                  </TableRow>
                ) : (
                  listData.map(employee => (
                    <TableRow key={employee.id}>
                      <TableCell className='font-mono text-xs'>{employee.employeeId}</TableCell>
                      <TableCell className='font-medium'>{employee.betterAuthUser?.name || '—'}</TableCell>
                      <TableCell className='text-muted-foreground'>{employee.betterAuthUser?.email || '—'}</TableCell>
                      <TableCell>{employee.designation?.name || '—'}</TableCell>
                      <TableCell>{employee.accessPreset?.name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant='secondary' className={EMPLOYMENT_TYPE_BADGE[employee.employmentType]}>
                          {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant='secondary' className={STATUS_BADGE[employee.status]}>
                          {STATUS_LABELS[employee.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right font-mono'>{formatCurrency(employee.salary)}</TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(employee)}>
                            <Pencil className='h-3.5 w-3.5' />
                          </Button>
                          <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => setDeleteTarget(employee)}>
                            <Trash2 className='h-3.5 w-3.5 text-destructive' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
          {totalPages > 1 && (
            <div className='flex items-center justify-between px-4 py-3 border-t'>
              <span className='text-sm text-muted-foreground'>
                Page {page} of {totalPages}
              </span>
              <div className='flex items-center gap-1'>
                <Button
                  variant='outline' size='icon' className='h-8 w-8'
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                ><ChevronLeft className='h-4 w-4' /></Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size='icon' className='h-8 w-8'
                    onClick={() => setPage(p)}
                  >{p}</Button>
                ))}
                <Button
                  variant='outline' size='icon' className='h-8 w-8'
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                ><ChevronRight className='h-4 w-4' /></Button>
              </div>
            </div>
          )}
        </Card>
      </Main>

      <Dialog open={editOpen} onOpenChange={o => { if (!o) { setEditOpen(false); setEditing(null) } }}>
        <DialogContent className='sm:max-w-[500px]'>
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className='grid gap-4 py-4'>
              <div className='grid grid-cols-2 gap-3'>
                <div className='font-semibold text-sm'>Name</div>
                <div>{editing.betterAuthUser?.name || '—'}</div>
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div className='grid gap-2'>
                  <Label>Employment Type</Label>
                  <Select value={editForm.employmentType} onValueChange={v => setEditForm(f => ({ ...f, employmentType: v as EmploymentType }))}>
                    <SelectTrigger><SelectValue placeholder='Select type' /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid gap-2'>
                  <Label>Status</Label>
                  <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v as EmployeeStatus }))}>
                    <SelectTrigger><SelectValue placeholder='Select status' /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div className='grid gap-2'>
                  <Label>Salary</Label>
                  <Input type='number' step='0.01' value={editForm.salary} onChange={e => setEditForm(f => ({ ...f, salary: e.target.value }))} />
                </div>
                <div className='grid gap-2'>
                  <Label>Bank Account</Label>
                  <Input value={editForm.bankAccountNo} onChange={e => setEditForm(f => ({ ...f, bankAccountNo: e.target.value }))} />
                </div>
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div className='grid gap-2'>
                  <Label>Bank Name</Label>
                  <Input value={editForm.bankName} onChange={e => setEditForm(f => ({ ...f, bankName: e.target.value }))} />
                </div>
              </div>
              <div className='grid gap-2'>
                <Label>Notes</Label>
                <textarea
                  className='flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none'
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => { setEditOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMut.isPending}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>Delete Employee</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Are you sure you want to delete {deleteTarget?.betterAuthUser?.name}? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant='destructive' onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} disabled={deleteMut.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
