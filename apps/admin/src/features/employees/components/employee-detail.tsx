import { useState, type ComponentType, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  CreditCard,
  Loader2,
  Pencil,
  Percent,
  RotateCcw,
  Wallet,
} from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { DatePicker } from '@/components/date-picker'
import { useEmployeeQuery, useUpdateEmployeeMutation, useBankAccountsQuery, useCreateBankAccountMutation, useUpdateBankAccountMutation, useDeleteBankAccountMutation, useSetPrimaryBankAccountMutation } from '../hooks'
import { employeesApi, type EmployeeStatus, type EmploymentType, type UpdateEmployeeDto, type AttendanceMethod, type EmployeeResponse, type EmployeeGender } from '../api'
import { BankAccountsCard } from './bank-accounts-card'
import { SalaryHistoryCard } from '@/features/payroll/components/salary-history'
import { useSalaryStructureHistoryQuery, usePayrollSummaryQuery } from '@/features/payroll/hooks'
import { STATUS_BADGE, STATUS_LABELS, EMPLOYMENT_TYPE_BADGE, EMPLOYMENT_TYPE_LABELS } from '../index'
import { useDepartmentsQuery } from '@/features/departments/hooks'
import { useDesignationsQuery } from '@/features/designations/hooks'
import { useScheduleQuery, useHistoryQuery } from '@/features/hr-schedule/hooks'
import { ScheduleEditor } from '@/features/hr-schedule/components/schedule-editor'
import { MonthCalendar } from '@/features/hr-schedule/components/month-calendar'
import { HistoryTable } from '@/features/hr-schedule/components/history-table'
import { useSalaryStructureQuery, useSetSalaryStructureMutation, usePayslipsQuery } from '@/features/payroll/hooks'
import { PayslipDialog } from '@/features/payroll/components/payslip-dialog'
import { PayslipDetail } from '@/features/payroll/components/payslip-detail'
import { PaymentsPanel } from '@/features/payroll/components/payments-panel'
import { PAYSLIP_STATUS_BADGE } from '@/features/payroll/components/payslip-status-badge'
import { EarningsTable } from '@/features/hr-ledgers/components/earnings-table'
import { DeductionsTable } from '@/features/hr-ledgers/components/deductions-table'
import { CommissionEarningsTab } from '@/features/commissions/components/earnings-table'
import { LeaveTab } from '@/features/hr-leave'
import { AttendanceTab } from '@/features/hr-attendance/components/attendance-tab'

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatSalary(salary?: number | null) {
  if (salary == null) return '—'
  return `${salary.toLocaleString()} ৳`
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className='text-xs font-medium text-muted-foreground'>{label}</p>
      <div className='mt-1 text-sm'>{children}</div>
    </div>
  )
}

function PlaceholderTab({ icon: Icon, module }: { icon: ComponentType<{ className?: string }>; module: string }) {
  void Icon
  return (
    <Card>
      <CardContent className='flex flex-col items-center justify-center py-16 text-center'>
        <Icon className='h-8 w-8 text-muted-foreground/60' />
        <p className='mt-3 text-sm font-medium text-muted-foreground'>
          This section arrives with the {module} module.
        </p>
      </CardContent>
    </Card>
  )
}

interface EmploymentForm {
  status: EmployeeStatus | ''
  employmentType: EmploymentType | ''
  departmentId: string
  designationId: string
  reportingToId: string
  exitDate?: Date
  confirmationDate?: Date
  exitReason: string
  attendanceMethod: AttendanceMethod | ''
  notes: string
}

const SALARY_FIELDS: { key: string; label: string }[] = [
  { key: 'basicSalary', label: 'Basic Salary' },
  { key: 'houseAllowance', label: 'House Allowance' },
  { key: 'medicalAllowance', label: 'Medical Allowance' },
  { key: 'transportAllowance', label: 'Transport Allowance' },
  { key: 'otherAllowance', label: 'Other Allowance' },
  { key: 'taxDeduction', label: 'Tax Deduction' },
  { key: 'insuranceDeduction', label: 'Insurance Deduction' },
  { key: 'otherDeduction', label: 'Other Deduction' },
]

function CompensationTab({ employeeId, mirrorSalary }: { employeeId: string; mirrorSalary?: number | null }) {
  const { data: structure, isLoading, isError, refetch } = useSalaryStructureQuery(employeeId)
  const { data: historyData, isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useSalaryStructureHistoryQuery(employeeId)
  const { data: summary, isLoading: summaryLoading } = usePayrollSummaryQuery(employeeId)
  const setMut = useSetSalaryStructureMutation(employeeId)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({
    basicSalary: '0',
    houseAllowance: '0',
    medicalAllowance: '0',
    transportAllowance: '0',
    otherAllowance: '0',
    taxDeduction: '0',
    insuranceDeduction: '0',
    otherDeduction: '0',
    effectiveFrom: '',
  })

  function openDialog() {
    setForm({
      basicSalary: String(structure?.basicSalary ?? 0),
      houseAllowance: String(structure?.houseAllowance ?? 0),
      medicalAllowance: String(structure?.medicalAllowance ?? 0),
      transportAllowance: String(structure?.transportAllowance ?? 0),
      otherAllowance: String(structure?.otherAllowance ?? 0),
      taxDeduction: String(structure?.taxDeduction ?? 0),
      insuranceDeduction: String(structure?.insuranceDeduction ?? 0),
      otherDeduction: String(structure?.otherDeduction ?? 0),
      effectiveFrom: '',
    })
    setOpen(true)
  }

  function num(key: string) {
    const n = Number(form[key])
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  function handleSubmit() {
    if (!form.effectiveFrom) return
    setMut.mutate(
      {
        employeeId,
        basicSalary: num('basicSalary'),
        houseAllowance: num('houseAllowance'),
        medicalAllowance: num('medicalAllowance'),
        transportAllowance: num('transportAllowance'),
        otherAllowance: num('otherAllowance'),
        taxDeduction: num('taxDeduction'),
        insuranceDeduction: num('insuranceDeduction'),
        otherDeduction: num('otherDeduction'),
        effectiveFrom: new Date(form.effectiveFrom).toISOString(),
      },
      { onSuccess: () => setOpen(false) },
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className='py-16'>
          <Skeleton className='h-40 w-full' />
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className='flex flex-col items-center gap-3 py-16 text-center'>
          <p className='text-sm text-muted-foreground'>Could not load salary structure.</p>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            <RotateCcw className='h-4 w-4 mr-1' /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Current Salary Structure</CardTitle>
            <CardDescription>
              Employee.salary (mirror): {mirrorSalary == null ? '—' : `${mirrorSalary.toLocaleString()} ৳`}
            </CardDescription>
          </div>
          <Button variant='outline' size='sm' onClick={openDialog}>
            <Pencil className='h-3.5 w-3.5 mr-1' />
            {structure ? 'Change Salary Structure' : 'Set Salary Structure'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!structure ? (
          <div className='flex flex-col items-center gap-3 py-12 text-center'>
            <p className='text-sm text-muted-foreground'>No active salary structure yet.</p>
            <Button size='sm' onClick={openDialog}>Set Salary Structure</Button>
          </div>
        ) : (
          <div className='grid gap-6 sm:grid-cols-2'>
            <div className='space-y-3'>
              <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Earnings</p>
              <div className='grid grid-cols-2 gap-x-6 gap-y-3'>
                <InfoRow label='Basic'>{Number(structure.basicSalary).toLocaleString()} ৳</InfoRow>
                <InfoRow label='House Allowance'>{Number(structure.houseAllowance).toLocaleString()} ৳</InfoRow>
                <InfoRow label='Medical Allowance'>{Number(structure.medicalAllowance).toLocaleString()} ৳</InfoRow>
                <InfoRow label='Transport Allowance'>{Number(structure.transportAllowance).toLocaleString()} ৳</InfoRow>
                <InfoRow label='Other Allowance'>{Number(structure.otherAllowance).toLocaleString()} ৳</InfoRow>
                <InfoRow label='Total Earnings'>{Number(structure.totalEarnings).toLocaleString()} ৳</InfoRow>
              </div>
            </div>
            <div className='space-y-3'>
              <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Deductions</p>
              <div className='grid grid-cols-2 gap-x-6 gap-y-3'>
                <InfoRow label='Tax'>{Number(structure.taxDeduction).toLocaleString()} ৳</InfoRow>
                <InfoRow label='Insurance'>{Number(structure.insuranceDeduction).toLocaleString()} ৳</InfoRow>
                <InfoRow label='Other'>{Number(structure.otherDeduction).toLocaleString()} ৳</InfoRow>
                <InfoRow label='Total Deductions'>{Number(structure.totalDeductions).toLocaleString()} ৳</InfoRow>
              </div>
            </div>
          </div>
        )}
        {structure && (
          <div className='mt-6 rounded-lg border bg-muted/40 p-4'>
            <div className='flex items-center justify-between'>
              <p className='text-sm font-medium text-muted-foreground'>Net Salary</p>
              <p className='text-2xl font-bold tabular-nums'>{Number(structure.netSalary).toLocaleString()} ৳</p>
            </div>
          </div>
        )}
      </CardContent>

      <div className='mt-4'>
        <SalaryHistoryCard
          structures={historyData ?? []}
          summary={summary}
          mirrorSalary={mirrorSalary}
          isLoading={historyLoading || summaryLoading}
          isError={historyError}
          onRetry={refetchHistory}
        />
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
        <DialogContent className='sm:max-w-[560px]'>
          <DialogHeader>
            <DialogTitle>{structure ? 'Change Salary Structure' : 'Set Salary Structure'}</DialogTitle>
          </DialogHeader>
          <div className='grid gap-3 py-4 sm:grid-cols-2'>
            <div className='grid gap-2 col-span-2'>
              <Label>Effective From *</Label>
              <DatePicker
                selected={form.effectiveFrom ? new Date(form.effectiveFrom) : undefined}
                onSelect={(d) => setForm(f => ({ ...f, effectiveFrom: d ? d.toISOString() : '' }))}
                placeholder='Pick effective date (required)'
              />
              {!form.effectiveFrom && (
                <p className='text-xs text-destructive'>Effective date is required.</p>
              )}
            </div>
            {SALARY_FIELDS.map((f) => (
              <div className='grid gap-2' key={f.key}>
                <Label>{f.label}</Label>
                <Input
                  type='number'
                  min={0}
                  value={form[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={setMut.isPending}>
              {setMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
              Save Structure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function PayrollTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = usePayslipsQuery({ employeeId })
  const [viewId, setViewId] = useState<string | null>(null)

  const rows = Array.isArray(data?.data) ? data.data : []

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Payslips</CardTitle>
            <CardDescription>Generate and review this employee's payslips.</CardDescription>
          </div>
          <PayslipDialog employeeId={employeeId} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className='flex justify-center py-8'>
            <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
          </div>
        ) : isError ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-muted-foreground'>Could not load payslips.</p>
            <Button variant='outline' size='sm' onClick={() => refetch()}>
              <RotateCcw className='h-4 w-4 mr-1' /> Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>
            No payslips yet. Generate one to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Range</TableHead>
                <TableHead className='text-right'>Net Pay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='w-20'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const badge = PAYSLIP_STATUS_BADGE[row.status]
                return (
                  <TableRow key={row.id}>
                    <TableCell className='font-medium'>{row.periodKey ?? '—'}</TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {Number(row.netPay).toLocaleString()} ৳
                    </TableCell>
                    <TableCell>
                      <Badge className={`border-transparent ${badge.className}`}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant='ghost' size='sm' onClick={() => setViewId(row.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!viewId} onOpenChange={(o) => { if (!o) setViewId(null) }}>
        <DialogContent className='sm:max-w-[640px]'>
          <DialogHeader>
            <DialogTitle>Payslip Detail</DialogTitle>
          </DialogHeader>
          {viewId && <PayslipDetail payslipId={viewId} />}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function PersonalInfoCard({ employee }: { employee: EmployeeResponse }) {
  const updateMut = useUpdateEmployeeMutation()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    dateOfBirth: employee.dateOfBirth ? new Date(employee.dateOfBirth) : undefined,
    gender: (employee.gender || '') as EmployeeGender | '',
    nationality: employee.nationality || '',
    nidNumber: employee.nidNumber || '',
    presentAddress: employee.presentAddress || '',
    permanentAddress: employee.permanentAddress || '',
    emergencyContactName: employee.emergencyContactName || '',
    emergencyContactPhone: employee.emergencyContactPhone || '',
    emergencyContactRelation: employee.emergencyContactRelation || '',
  })

  const openPersonalEdit = () => {
    setForm({
      dateOfBirth: employee.dateOfBirth ? new Date(employee.dateOfBirth) : undefined,
      gender: (employee.gender || '') as EmployeeGender | '',
      nationality: employee.nationality || '',
      nidNumber: employee.nidNumber || '',
      presentAddress: employee.presentAddress || '',
      permanentAddress: employee.permanentAddress || '',
      emergencyContactName: employee.emergencyContactName || '',
      emergencyContactPhone: employee.emergencyContactPhone || '',
      emergencyContactRelation: employee.emergencyContactRelation || '',
    })
    setOpen(true)
  }

  const savePersonal = () => {
    const dto: UpdateEmployeeDto = {
      dateOfBirth: form.dateOfBirth ? form.dateOfBirth.toISOString() : null,
      gender: form.gender || null,
      nationality: form.nationality || null,
      nidNumber: form.nidNumber || null,
      presentAddress: form.presentAddress || null,
      permanentAddress: form.permanentAddress || null,
      emergencyContactName: form.emergencyContactName || null,
      emergencyContactPhone: form.emergencyContactPhone || null,
      emergencyContactRelation: form.emergencyContactRelation || null,
    }
    updateMut.mutate({ id: employee.id, dto }, { onSuccess: () => setOpen(false) })
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>HR master data — identity stays with the user account.</CardDescription>
          </div>
          <Button variant='outline' size='sm' onClick={openPersonalEdit}>
            <Pencil className='h-3.5 w-3.5 mr-1' /> Edit Personal Info
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className='grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3'>
          <InfoRow label='Date of Birth'>{formatDate(employee.dateOfBirth)}</InfoRow>
          <InfoRow label='Gender'>{employee.gender || '—'}</InfoRow>
          <InfoRow label='Nationality'>{employee.nationality || '—'}</InfoRow>
          <InfoRow label='NID Number'>{employee.nidNumber || '—'}</InfoRow>
          <InfoRow label='Phone'>{'—'}</InfoRow>
          <InfoRow label='Email'>{employee.betterAuthUser?.email || '—'}</InfoRow>
          <InfoRow label='Present Address'>{employee.presentAddress || '—'}</InfoRow>
          <InfoRow label='Permanent Address'>{employee.permanentAddress || '—'}</InfoRow>
          <InfoRow label='Emergency Contact'>
            {employee.emergencyContactName
              ? `${employee.emergencyContactName}${employee.emergencyContactPhone ? ` · ${employee.emergencyContactPhone}` : ''}${employee.emergencyContactRelation ? ` (${employee.emergencyContactRelation})` : ''}`
              : '—'}
          </InfoRow>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
        <DialogContent className='sm:max-w-[620px]'>
          <DialogHeader>
            <DialogTitle>Edit Personal Information</DialogTitle>
          </DialogHeader>
          <div className='grid gap-3 py-4 sm:grid-cols-2'>
            <div className='grid gap-2'>
              <Label>Date of Birth</Label>
              <DatePicker selected={form.dateOfBirth} onSelect={(d) => setForm(f => ({ ...f, dateOfBirth: d }))} placeholder='Pick date' />
            </div>
            <div className='grid gap-2'>
              <Label>Gender</Label>
              <Select value={form.gender || 'none'} onValueChange={(v) => setForm(f => ({ ...f, gender: v === 'none' ? '' : v as EmployeeGender }))}>
                <SelectTrigger><SelectValue placeholder='Select gender' /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>— None —</SelectItem>
                  <SelectItem value='MALE'>Male</SelectItem>
                  <SelectItem value='FEMALE'>Female</SelectItem>
                  <SelectItem value='OTHER'>Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label>Nationality</Label>
              <Input value={form.nationality} onChange={(e) => setForm(f => ({ ...f, nationality: e.target.value }))} />
            </div>
            <div className='grid gap-2'>
              <Label>NID Number</Label>
              <Input value={form.nidNumber} onChange={(e) => setForm(f => ({ ...f, nidNumber: e.target.value }))} autoComplete='off' />
            </div>
            <div className='grid gap-2 col-span-2'>
              <Label>Present Address</Label>
              <Textarea value={form.presentAddress} onChange={(e) => setForm(f => ({ ...f, presentAddress: e.target.value }))} rows={2} />
            </div>
            <div className='grid gap-2 col-span-2'>
              <Label>Permanent Address</Label>
              <Textarea value={form.permanentAddress} onChange={(e) => setForm(f => ({ ...f, permanentAddress: e.target.value }))} rows={2} />
            </div>
            <div className='grid gap-2'>
              <Label>Emergency Contact Name</Label>
              <Input value={form.emergencyContactName} onChange={(e) => setForm(f => ({ ...f, emergencyContactName: e.target.value }))} />
            </div>
            <div className='grid gap-2'>
              <Label>Emergency Contact Phone</Label>
              <Input value={form.emergencyContactPhone} onChange={(e) => setForm(f => ({ ...f, emergencyContactPhone: e.target.value }))} />
            </div>
            <div className='grid gap-2'>
              <Label>Emergency Contact Relationship</Label>
              <Input value={form.emergencyContactRelation} onChange={(e) => setForm(f => ({ ...f, emergencyContactRelation: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={savePersonal} disabled={updateMut.isPending}>
              {updateMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
              Save Personal Info
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function BankAccountsSection({ employeeId }: { employeeId: string }) {
  const { data: accounts = [], isLoading, isError, refetch } = useBankAccountsQuery(employeeId)
  const createMut = useCreateBankAccountMutation(employeeId)
  const updateMut = useUpdateBankAccountMutation(employeeId)
  const deleteMut = useDeleteBankAccountMutation(employeeId)
  const primaryMut = useSetPrimaryBankAccountMutation(employeeId)

  if (isError) {
    return (
      <Card>
        <CardContent className='flex flex-col items-center gap-3 py-10 text-center'>
          <p className='text-sm text-muted-foreground'>Could not load bank accounts.</p>
          <Button variant='outline' size='sm' onClick={() => refetch()}>
            <RotateCcw className='h-4 w-4 mr-1' /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <BankAccountsCard
      accounts={accounts}
      isLoading={isLoading}
      isSubmitting={createMut.isPending || updateMut.isPending || primaryMut.isPending}
      onAdd={(dto) => createMut.mutate(dto)}
      onEdit={(id, dto) => updateMut.mutate({ id, dto })}
      onDelete={(id) => deleteMut.mutate(id)}
      onSetPrimary={(id) => primaryMut.mutate(id)}
    />
  )
}

export function EmployeeDetailPage({ employeeId }: { employeeId: string }) {
  const {
    data: employee,
    isLoading,
    isError,
    error: employeeError,
    refetch,
  } = useEmployeeQuery(employeeId)
  const { data: scheduleData, isError: scheduleError, refetch: refetchSchedule } = useScheduleQuery(employeeId)
  const [historyPage, setHistoryPage] = useState(1)
  const { data: historyData, isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useHistoryQuery(employeeId, historyPage)

  const updateEmpMut = useUpdateEmployeeMutation()

  const [empEditOpen, setEmpEditOpen] = useState(false)
  const [empForm, setEmpForm] = useState<EmploymentForm>({
    status: '',
    employmentType: '',
    departmentId: '',
    designationId: '',
    reportingToId: '',
    exitDate: undefined,
    confirmationDate: undefined,
    exitReason: '',
    attendanceMethod: '',
    notes: '',
  })

  const { data: departments } = useDepartmentsQuery()
  const { data: designations } = useDesignationsQuery()

  const { data: allEmployees } = useQuery({
    queryKey: ['employees', 'picker'],
    queryFn: () =>
      employeesApi
        .list({ page: 1, perPage: 100 })
        .then((r) => r.data.data),
    enabled: empEditOpen,
  })

  if (isLoading) {
    return (
      <>
        <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
        <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
          <Skeleton className='h-5 w-28' />
          <Skeleton className='h-9 w-64' />
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-64 w-full' />
        </Main>
      </>
    )
  }

  if (isError || !employee) {
    const notFound = (employeeError as any)?.response?.status === 404
    return (
      <>
        <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
        <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
          <Card>
            <CardContent className='flex flex-col items-center gap-3 py-16 text-center'>
              <p className='text-sm text-muted-foreground'>
                {notFound
                  ? 'Employee not found. It may have been deleted or you do not have access.'
                  : 'Could not load employee details.'}
              </p>
              <Button variant='outline' size='sm' onClick={() => refetch()}>
                <RotateCcw className='h-4 w-4 mr-1' /> Retry
              </Button>
            </CardContent>
          </Card>
        </Main>
      </>
    )
  }

  const openEditEmployment = () => {
    setEmpForm({
      status: employee.status,
      employmentType: employee.employmentType,
      departmentId: employee.departmentId || '',
      designationId: employee.designationId || '',
      reportingToId: employee.reportingTo?.id || '',
      exitDate: employee.exitDate ? new Date(employee.exitDate) : undefined,
      confirmationDate: employee.confirmationDate ? new Date(employee.confirmationDate) : undefined,
      exitReason: employee.exitReason || '',
      attendanceMethod: employee.attendanceMethod,
      notes: employee.notes || '',
    })
    setEmpEditOpen(true)
  }

  const handleSaveEmployment = () => {
    const dto: UpdateEmployeeDto = {}
    if (empForm.status) dto.status = empForm.status
    if (empForm.employmentType) dto.employmentType = empForm.employmentType
    dto.departmentId = empForm.departmentId || null
    dto.designationId = empForm.designationId || null
    dto.reportingToId = empForm.reportingToId || null
    if (empForm.exitDate) dto.exitDate = empForm.exitDate.toISOString()
    if (empForm.confirmationDate) dto.confirmationDate = empForm.confirmationDate.toISOString()
    if (empForm.exitReason) dto.exitReason = empForm.exitReason
    if (empForm.attendanceMethod) dto.attendanceMethod = empForm.attendanceMethod
    dto.notes = empForm.notes || undefined
    updateEmpMut.mutate({ id: employee.id, dto }, { onSuccess: () => setEmpEditOpen(false) })
  }

  const isTerminal = empForm.status === 'terminated' || empForm.status === 'resigned'

  const overviewChips = [
    { label: 'Joined', value: formatDate(employee.joiningDate) },
    { label: 'Employment Type', value: EMPLOYMENT_TYPE_LABELS[employee.employmentType] },
    { label: 'Salary', value: formatSalary(employee.salary) },
    { label: 'Reporting To', value: employee.reportingTo?.betterAuthUser?.name || '—' },
  ]

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <Link
          to='/hr/employees'
          className='inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground'
        >
          <ArrowLeft className='mr-2 h-4 w-4' /> Employees
        </Link>

        <Card>
          <CardContent className='flex flex-wrap items-center gap-x-4 gap-y-3 pt-6'>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <h2 className='text-2xl font-bold tracking-tight truncate'>
                  {employee.betterAuthUser?.name || '—'}
                </h2>
                <Badge variant='outline' className='font-mono text-xs shrink-0'>
                  {employee.employeeId}
                </Badge>
              </div>
              <p className='mt-1 text-sm text-muted-foreground'>
                {employee.department?.name || 'No department'} · {employee.designation?.name || 'No designation'}
              </p>
            </div>
            <div className='flex items-center gap-2'>
              <Badge variant='secondary' className={STATUS_BADGE[employee.status]}>
                {STATUS_LABELS[employee.status]}
              </Badge>
              <Badge variant='secondary' className={EMPLOYMENT_TYPE_BADGE[employee.employmentType]}>
                {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue='overview'>
          <TabsList className='h-auto w-full flex-nowrap overflow-x-auto lg:flex-wrap lg:overflow-visible'>
            <TabsTrigger value='overview'>Overview</TabsTrigger>
            <TabsTrigger value='employment'>Employment</TabsTrigger>
            <TabsTrigger value='compensation'>Compensation</TabsTrigger>
            <TabsTrigger value='payroll'>Payroll</TabsTrigger>
            <TabsTrigger value='payments'>Payments</TabsTrigger>
            <TabsTrigger value='commission'>Commission</TabsTrigger>
            <TabsTrigger value='earnings'>Earnings</TabsTrigger>
            <TabsTrigger value='deductions'>Deductions</TabsTrigger>
            <TabsTrigger value='leave'>Leave</TabsTrigger>
            <TabsTrigger value='attendance'>Attendance</TabsTrigger>
            <TabsTrigger value='schedule'>Schedule &amp; History</TabsTrigger>
          </TabsList>

          <TabsContent value='overview' className='space-y-4'>
            <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
              {overviewChips.map((chip) => (
                <Card key={chip.label}>
                  <CardContent className='p-3'>
                    <p className='text-xs font-medium text-muted-foreground'>{chip.label}</p>
                    <p className='mt-0.5 truncate text-sm font-semibold'>{chip.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3'>
                  <InfoRow label='Joining Date'>{formatDate(employee.joiningDate)}</InfoRow>
                  <InfoRow label='Exit Date'>{formatDate(employee.exitDate)}</InfoRow>
                  <InfoRow label='Salary'>{formatSalary(employee.salary)}</InfoRow>
                  <InfoRow label='Bank Account'>
                    {employee.bankName ? `${employee.bankName} · ${employee.bankAccountNo || '—'}` : employee.bankAccountNo || '—'}
                  </InfoRow>
                  <InfoRow label='Reporting Manager'>
                    {employee.reportingTo?.betterAuthUser?.name || '—'}
                  </InfoRow>
                  <InfoRow label='Notes'>{employee.notes || '—'}</InfoRow>
                </div>
              </CardContent>
            </Card>
            <PersonalInfoCard employee={employee} />
            <BankAccountsSection employeeId={employee.id} />
          </TabsContent>

          <TabsContent value='employment' className='space-y-4'>
            <Card>
              <CardHeader>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div>
                    <CardTitle>Employment Details</CardTitle>
                    <CardDescription>Status, team placement and reporting line.</CardDescription>
                  </div>
                  <Button variant='outline' size='sm' onClick={openEditEmployment}>
                    <Pencil className='h-3.5 w-3.5 mr-1' /> Edit Employment
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className='grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3'>
                  <InfoRow label='Status'>
                    <Badge variant='secondary' className={STATUS_BADGE[employee.status]}>
                      {STATUS_LABELS[employee.status]}
                    </Badge>
                  </InfoRow>
                  <InfoRow label='Employment Type'>
                    {EMPLOYMENT_TYPE_LABELS[employee.employmentType]}
                  </InfoRow>
                  <InfoRow label='Department'>{employee.department?.name || '—'}</InfoRow>
                  <InfoRow label='Designation'>{employee.designation?.name || '—'}</InfoRow>
                  <InfoRow label='Reporting Manager'>
                    {employee.reportingTo?.betterAuthUser?.name || (
                      <span className='text-muted-foreground'>—</span>
                    )}
                  </InfoRow>
                  <InfoRow label='Exit Date'>{formatDate(employee.exitDate)}</InfoRow>
                  <InfoRow label='Confirmation Date'>{formatDate(employee.confirmationDate)}</InfoRow>
                  <InfoRow label='Exit Reason'>{employee.exitReason || '—'}</InfoRow>
                  <InfoRow label='Attendance Method'>{employee.attendanceMethod || '—'}</InfoRow>
                </div>
              </CardContent>
            </Card>

            <Dialog open={empEditOpen} onOpenChange={o => { if (!o) setEmpEditOpen(false) }}>
              <DialogContent className='sm:max-w-[560px]'>
                <DialogHeader>
                  <DialogTitle>Edit Employment</DialogTitle>
                </DialogHeader>
                <div className='grid gap-4 py-4'>
                  <div className='grid grid-cols-2 gap-3'>
                    <div className='grid gap-2'>
                      <Label>Status</Label>
                      <Select value={empForm.status} onValueChange={v => setEmpForm(f => ({ ...f, status: v as EmployeeStatus }))}>
                        <SelectTrigger><SelectValue placeholder='Select status' /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isTerminal && (
                        <p className='text-xs text-amber-600 dark:text-amber-400'>
                          Exit date is required for {empForm.status === 'terminated' ? 'Terminated' : 'Resigned'}.
                        </p>
                      )}
                    </div>
                    <div className='grid gap-2'>
                      <Label>Employment Type</Label>
                      <Select value={empForm.employmentType} onValueChange={v => setEmpForm(f => ({ ...f, employmentType: v as EmploymentType }))}>
                        <SelectTrigger><SelectValue placeholder='Select type' /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='grid gap-2'>
                      <Label>Department</Label>
                      <Select value={empForm.departmentId || 'none'} onValueChange={v => setEmpForm(f => ({ ...f, departmentId: v === 'none' ? '' : v }))}>
                        <SelectTrigger><SelectValue placeholder='Select department' /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>— None —</SelectItem>
                          {(departments?.data || []).map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='grid gap-2'>
                      <Label>Designation</Label>
                      <Select value={empForm.designationId || 'none'} onValueChange={v => setEmpForm(f => ({ ...f, designationId: v === 'none' ? '' : v }))}>
                        <SelectTrigger><SelectValue placeholder='Select designation' /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>— None —</SelectItem>
                          {(designations || []).map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='grid gap-2 col-span-2 sm:col-span-1'>
                      <Label>Reporting Manager</Label>
                      <SearchableSelect
                        options={(allEmployees || [])
                          .filter(e => e.id !== employee.id)
                          .map(e => ({
                            id: e.id,
                            label: `${e.employeeId} · ${e.betterAuthUser?.name || '—'}`,
                          }))}
                        value={empForm.reportingToId}
                        onChange={v => setEmpForm(f => ({ ...f, reportingToId: v }))}
                        placeholder='Select reporting manager'
                        emptyMessage='No employees found'
                      />
                    </div>
                    <div className='grid gap-2 col-span-2 sm:col-span-1'>
                      <Label>Exit Date</Label>
                      <DatePicker
                        selected={empForm.exitDate}
                        onSelect={d => setEmpForm(f => ({ ...f, exitDate: d }))}
                        placeholder='Pick exit date'
                      />
                    </div>
                    <div className='grid gap-2 col-span-2 sm:col-span-1'>
                      <Label>Confirmation Date</Label>
                      <DatePicker
                        selected={empForm.confirmationDate}
                        onSelect={d => setEmpForm(f => ({ ...f, confirmationDate: d }))}
                        placeholder='Pick confirmation date'
                      />
                    </div>
                    <div className='grid gap-2 col-span-2 sm:col-span-2'>
                      <Label>Attendance Method</Label>
                      <Select
                        value={empForm.attendanceMethod || 'none'}
                        onValueChange={v => setEmpForm(f => ({ ...f, attendanceMethod: v === 'none' ? '' : v as AttendanceMethod }))}
                      >
                        <SelectTrigger><SelectValue placeholder='Select attendance method' /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value='none'>— Not set —</SelectItem>
                          <SelectItem value='APP'>App</SelectItem>
                          <SelectItem value='MACHINE'>Machine</SelectItem>
                          <SelectItem value='NONE'>None (disabled)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className='grid gap-2'>
                    <Label>Exit Reason</Label>
                    <Input
                      value={empForm.exitReason}
                      onChange={e => setEmpForm(f => ({ ...f, exitReason: e.target.value }))}
                      placeholder='Reason for exit (optional)'
                    />
                  </div>
                  <div className='grid gap-2'>
                    <Label>Notes</Label>
                    <Input value={empForm.notes} onChange={e => setEmpForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant='outline' onClick={() => setEmpEditOpen(false)}>Cancel</Button>
                  <Button onClick={handleSaveEmployment} disabled={updateEmpMut.isPending}>
                    {updateEmpMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
                    Save Changes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value='compensation'>
            <CompensationTab employeeId={employee.id} mirrorSalary={employee.salary} />
          </TabsContent>
          <TabsContent value='payroll'>
            <PayrollTab employeeId={employee.id} />
          </TabsContent>
          <TabsContent value='payments'>
            <PaymentsPanel employeeId={employee.id} />
          </TabsContent>
          <TabsContent value='commission'>
            <CommissionEarningsTab employeeId={employee.id} />
          </TabsContent>
          <TabsContent value='earnings'>
            <EarningsTable employeeId={employee.id} />
          </TabsContent>
          <TabsContent value='deductions'>
            <DeductionsTable employeeId={employee.id} />
          </TabsContent>
          <TabsContent value='leave'>
            <LeaveTab employeeId={employee.id} />
          </TabsContent>

          <TabsContent value='attendance'>
            <AttendanceTab employeeId={employee.id} />
          </TabsContent>

          <TabsContent value='schedule' className='space-y-4'>
            <div className='grid gap-4 lg:grid-cols-2'>
              <Card>
                <CardHeader>
                  <CardTitle>Weekly Off</CardTitle>
                  <CardDescription>Days this employee does not work.</CardDescription>
                </CardHeader>
                <CardContent>
                  {scheduleError ? (
                    <div className='flex flex-col items-center gap-3 py-10 text-center'>
                      <p className='text-sm text-muted-foreground'>Could not load schedule.</p>
                      <Button variant='outline' size='sm' onClick={() => refetchSchedule()}>
                        <RotateCcw className='h-4 w-4 mr-1' /> Retry
                      </Button>
                    </div>
                  ) : (
                    <ScheduleEditor
                      employeeId={employee.id}
                      initialDays={scheduleData?.days ?? []}
                      initialNote={null}
                    />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Month Preview</CardTitle>
                  <CardDescription>Current month with weekly off highlighted.</CardDescription>
                </CardHeader>
                <CardContent>
                  <MonthCalendar days={scheduleData?.days ?? []} />
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Change History</CardTitle>
                <CardDescription>Employment and schedule changes.</CardDescription>
              </CardHeader>
              <CardContent className='p-0'>
                <HistoryTable
                  data={historyData?.data ?? []}
                  meta={historyData?.meta}
                  isLoading={historyLoading}
                  isError={historyError}
                  onRetry={refetchHistory}
                  onPageChange={setHistoryPage}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}