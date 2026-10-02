'use client'

import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { SelectDropdown } from '@/components/select-dropdown'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { DatePicker } from '@/components/date-picker'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Loader2, Search, ArrowLeft, ArrowRight, Check, Pencil, Clock, Building2, User, PhoneCall, ShieldAlert, Sparkles } from 'lucide-react'
import { useDesignationsQuery } from '@/features/designations/hooks'
import { useAccessPresetsQuery } from '@/features/access-presets/hooks'
import { useDepartmentsQuery } from '@/features/departments/hooks'
import { useShiftPresetsQuery } from '@/features/hr-shifts/hooks'
import { hrShiftsApi, DAY_NAMES } from '@/features/hr-shifts/api'
import {
  ShiftAssignmentPicker,
  DEFAULT_SHIFT_VALUE,
  type ShiftSelectionValue,
} from '@/features/hr-shifts/components/shift-assignment-picker'
import {
  employeesApi,
  type CreateEmployeeDto,
  type EmploymentType,
  type AttendanceMethod,
  type BankAccountType,
  type EmployeeResponse,
  type EmployeeGender,
  GENDER_LABELS,
} from './api'

const EMPLOYMENT_TYPES: { label: string; value: EmploymentType }[] = [
  { label: 'Full Time', value: 'full_time' },
  { label: 'Part Time', value: 'part_time' },
  { label: 'Contract', value: 'contract' },
  { label: 'Internship', value: 'internship' },
]

const ATTENDANCE_METHODS: { label: string; value: AttendanceMethod }[] = [
  { label: 'App', value: 'APP' },
  { label: 'Machine', value: 'MACHINE' },
  { label: 'None (disabled)', value: 'NONE' },
]

const BANK_TYPES: { label: string; value: BankAccountType }[] = [
  { label: 'Savings', value: 'SAVINGS' },
  { label: 'Current', value: 'CURRENT' },
  { label: 'Others', value: 'OTHERS' },
]

const GENDER_OPTIONS: { label: string; value: EmployeeGender }[] = [
  { label: 'Male', value: 'MALE' },
  { label: 'Female', value: 'FEMALE' },
  { label: 'Other', value: 'OTHER' },
]

const SALARY_FIELDS: { key: keyof SalaryForm; label: string; kind: 'allowance' | 'deduction' }[] = [
  { key: 'basicSalary', label: 'Basic Salary', kind: 'allowance' },
  { key: 'houseAllowance', label: 'House Allowance', kind: 'allowance' },
  { key: 'medicalAllowance', label: 'Medical Allowance', kind: 'allowance' },
  { key: 'transportAllowance', label: 'Transport Allowance', kind: 'allowance' },
  { key: 'otherAllowance', label: 'Other Allowance', kind: 'allowance' },
  { key: 'taxDeduction', label: 'Tax Deduction', kind: 'deduction' },
  { key: 'insuranceDeduction', label: 'Insurance Deduction', kind: 'deduction' },
  { key: 'otherDeduction', label: 'Other Deduction', kind: 'deduction' },
]

interface BasicsForm {
  joiningDate: Date | undefined
  confirmationDate: Date | undefined
  employmentType: EmploymentType
  departmentId: string
  designationId: string
  accessPresetId: string
  reportingToId: string
  attendanceMethod: AttendanceMethod | ''
}

interface PersonalForm {
  dateOfBirth: Date | undefined
  gender: EmployeeGender | ''
  nationality: string
  nidNumber: string
  presentAddress: string
  permanentAddress: string
  emergencyContactName: string
  emergencyContactPhone: string
  emergencyContactRelation: string
  notes: string
}

interface SalaryForm {
  basicSalary: string
  houseAllowance: string
  medicalAllowance: string
  transportAllowance: string
  otherAllowance: string
  taxDeduction: string
  insuranceDeduction: string
  otherDeduction: string
  effectiveFrom: Date | undefined
}

interface BankForm {
  bankName: string
  branchName: string
  accountName: string
  accountNumber: string
  accountType: BankAccountType | ''
  routingNumber: string
  isPrimary: boolean
}

function num(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function currency(n: number) {
  return n.toLocaleString()
}

export default function CreateEmployeePage() {
  const navigate = useNavigate()
  const { data: designations } = useDesignationsQuery()
  const { data: presets } = useAccessPresetsQuery(1, '')
  const { data: departments } = useDepartmentsQuery()
  const { data: shiftPresets = [] } = useShiftPresetsQuery()
  const { data: allEmployees } = useQuery({
    queryKey: ['employees', 'picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100 }).then((r) => r.data.data),
  })

  const [step, setStep] = useState<'search' | 'basics' | 'compensation' | 'bank' | 'review'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)

  const [basics, setBasics] = useState<BasicsForm>({
    joiningDate: undefined,
    confirmationDate: undefined,
    employmentType: 'full_time',
    departmentId: '',
    designationId: '',
    accessPresetId: '',
    reportingToId: '',
    attendanceMethod: '',
  })

  const [personal, setPersonal] = useState<PersonalForm>({
    dateOfBirth: undefined,
    gender: '',
    nationality: 'Bangladeshi',
    nidNumber: '',
    presentAddress: '',
    permanentAddress: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
    notes: '',
  })

  const [shiftValue, setShiftValue] = useState<ShiftSelectionValue>(DEFAULT_SHIFT_VALUE)
  const [enableShiftAssignment, setEnableShiftAssignment] = useState(true)

  const [addSalary, setAddSalary] = useState(false)
  const [salary, setSalary] = useState<SalaryForm>({
    basicSalary: '',
    houseAllowance: '0',
    medicalAllowance: '0',
    transportAllowance: '0',
    otherAllowance: '0',
    taxDeduction: '0',
    insuranceDeduction: '0',
    otherDeduction: '0',
    effectiveFrom: new Date(),
  })
  const [addBank, setAddBank] = useState(false)
  const [bank, setBank] = useState<BankForm>({
    bankName: '',
    branchName: '',
    accountName: '',
    accountNumber: '',
    accountType: '',
    routingNumber: '',
    isPrimary: true,
  })
  const [submitting, setSubmitting] = useState(false)

  const searchUsers = useCallback(async (q: string) => {
    if (q.length < 2) return
    setSearching(true)
    try {
      const res = await apiClient.get<{ data: any[] }>('/employees/search/ba-users', { params: { q } })
      setSearchResults(res.data.data)
    } catch {
      toast.error('Search failed')
    }
    setSearching(false)
  }, [])

  const basicsValid = !!selectedUser && !!basics.joiningDate
  const salaryValid = !addSalary || (num(salary.basicSalary) !== undefined && !!salary.effectiveFrom)
  const bankValid = !addBank || (bank.bankName.trim() !== '' && bank.accountNumber.trim() !== '')

  const netSalary = (() => {
    if (!addSalary) return null
    const basic = num(salary.basicSalary) ?? 0
    const earn = basic + (num(salary.houseAllowance) ?? 0) + (num(salary.medicalAllowance) ?? 0) + (num(salary.transportAllowance) ?? 0) + (num(salary.otherAllowance) ?? 0)
    const ded = (num(salary.taxDeduction) ?? 0) + (num(salary.insuranceDeduction) ?? 0) + (num(salary.otherDeduction) ?? 0)
    return earn - ded
  })()

  const handleSubmit = async () => {
    if (!selectedUser || !basics.joiningDate) {
      toast.error('Please fill all required fields')
      return
    }
    const payload: CreateEmployeeDto = {
      betterAuthUserId: selectedUser.id,
      joiningDate: basics.joiningDate.toISOString().slice(0, 10),
      confirmationDate: basics.confirmationDate ? basics.confirmationDate.toISOString().slice(0, 10) : undefined,
      employmentType: basics.employmentType,
      attendanceMethod: basics.attendanceMethod || undefined,
      departmentId: basics.departmentId || undefined,
      designationId: basics.designationId || undefined,
      accessPresetId: basics.accessPresetId || undefined,
      reportingToId: basics.reportingToId || undefined,
      dateOfBirth: personal.dateOfBirth ? personal.dateOfBirth.toISOString().slice(0, 10) : undefined,
      gender: (personal.gender || undefined) as EmployeeGender | undefined,
      nationality: personal.nationality.trim() || undefined,
      nidNumber: personal.nidNumber.trim() || undefined,
      presentAddress: personal.presentAddress.trim() || undefined,
      permanentAddress: personal.permanentAddress.trim() || undefined,
      emergencyContactName: personal.emergencyContactName.trim() || undefined,
      emergencyContactPhone: personal.emergencyContactPhone.trim() || undefined,
      emergencyContactRelation: personal.emergencyContactRelation.trim() || undefined,
      notes: personal.notes.trim() || undefined,
    }

    if (enableShiftAssignment) {
      if (shiftValue.mode === 'template' && shiftValue.presetId) {
        payload.shiftPresetId = shiftValue.presetId
        payload.shiftDays = shiftValue.templateDays
      } else if (shiftValue.mode === 'custom' && shiftValue.customStartTime && shiftValue.customEndTime) {
        try {
          const customPreset = await hrShiftsApi.findOrCreateCustom({
            startTime: shiftValue.customStartTime,
            endTime: shiftValue.customEndTime,
            graceMinutes: shiftValue.customGraceMinutes,
            breakMinutes: shiftValue.customBreakMinutes,
          }).then((r) => r.data)
          payload.shiftPresetId = customPreset.id
          payload.shiftDays = shiftValue.customDays
        } catch {
          toast.error('Could not configure custom shift hours')
          return
        }
      } else if (shiftValue.mode === 'rotation') {
        const items = Object.entries(shiftValue.rotation)
          .filter(([_, presetId]) => presetId && presetId !== '__none__')
          .map(([day, presetId]) => ({ dayOfWeek: Number(day), presetId }))
        if (items.length > 0) {
          payload.shiftRotations = items
        }
      }
    }

    if (addSalary && salary.basicSalary) {
      payload.salaryStructure = {
        basicSalary: num(salary.basicSalary)!,
        houseAllowance: num(salary.houseAllowance),
        medicalAllowance: num(salary.medicalAllowance),
        transportAllowance: num(salary.transportAllowance),
        otherAllowance: num(salary.otherAllowance),
        taxDeduction: num(salary.taxDeduction),
        insuranceDeduction: num(salary.insuranceDeduction),
        otherDeduction: num(salary.otherDeduction),
        effectiveFrom: salary.effectiveFrom ? salary.effectiveFrom.toISOString() : undefined,
      }
    }
    if (addBank && bank.bankName && bank.accountNumber) {
      payload.bankAccount = {
        bankName: bank.bankName,
        branchName: bank.branchName || undefined,
        accountName: bank.accountName || selectedUser.name,
        accountNumber: bank.accountNumber,
        accountType: (bank.accountType || undefined) as BankAccountType | undefined,
        routingNumber: bank.routingNumber || undefined,
        isPrimary: bank.isPrimary,
      }
    }
    setSubmitting(true)
    try {
      const res = await apiClient.post<{ data: EmployeeResponse }>('/employees', payload)
      const created = res.data.data ?? res.data
      toast.success('Employee created successfully')
      navigate({ to: '/hr/employees/$id', params: { id: created.id } })
    } catch (error: any) {
      const message = error.response?.data?.message
      const text = Array.isArray(message) ? message.join(', ') : message
      toast.error(text || 'Failed to create employee')
    } finally {
      setSubmitting(false)
    }
  }

  const departmentName = departments?.data?.find((d: any) => d.id === basics.departmentId)?.name
  const designationName = designations?.find((d: any) => d.id === basics.designationId)?.name
  const presetName = presets?.data?.find((p: any) => p.id === basics.accessPresetId)?.name
  const managerName = allEmployees?.find((e: any) => e.id === basics.reportingToId)?.betterAuthUser?.name
  const selectedShiftPreset = Array.isArray(shiftPresets) ? shiftPresets.find((p) => p.id === shiftValue.presetId) : undefined

  return (
    <>
      <Header fixed>
        <GlobalSearchBar /><ThemeSwitch /><ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6 max-w-3xl mx-auto w-full'>
        <Button variant='ghost' className='w-fit' onClick={() => navigate({ to: '/hr/employees' })}>
          <ArrowLeft className='mr-2 h-4 w-4' /> Back to Employees
        </Button>
        <h2 className='text-2xl font-bold tracking-tight'>Register New Employee</h2>

        {step === 'search' && (
          <Card>
            <CardHeader><CardTitle>Step 1 — Select a User</CardTitle></CardHeader>
            <CardContent className='space-y-4'>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
                <Input
                  className='pl-10'
                  placeholder='Search by name or email...'
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); searchUsers(e.target.value) }}
                />
              </div>
              {searching && <div className='flex justify-center'><Loader2 className='animate-spin h-5 w-5' /></div>}
              <div className='space-y-2'>
                {searchResults.map((user) => (
                  <div
                    key={user.id}
                    className='flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/50'
                    onClick={() => { setSelectedUser(user); setStep('basics') }}
                  >
                    <div>
                      <p className='font-medium'>{user.name}</p>
                      <p className='text-sm text-muted-foreground'>{user.email}</p>
                    </div>
                    <Button size='sm'>Select</Button>
                  </div>
                ))}
                {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
                  <p className='text-center text-muted-foreground py-4'>No users found</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {step === 'basics' && selectedUser && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Step 2 — User &amp; Basics</CardTitle>
              </CardHeader>
              <CardContent className='space-y-5'>
                <div className='flex items-center justify-between rounded-lg border p-3 bg-muted/20'>
                  <div>
                    <p className='font-medium'>{selectedUser.name}</p>
                    <p className='text-sm text-muted-foreground'>{selectedUser.email}</p>
                  </div>
                  <Button variant='outline' size='sm' onClick={() => { setStep('search') }}>
                    <Pencil className='h-3.5 w-3.5 mr-1' /> Change
                  </Button>
                </div>

                <Tabs defaultValue='role' className='w-full'>
                  <TabsList className='grid grid-cols-3 w-full mb-2'>
                    <TabsTrigger value='role' className='text-xs sm:text-sm'>1. Role &amp; Organization</TabsTrigger>
                    <TabsTrigger value='personal' className='text-xs sm:text-sm'>2. Personal &amp; Emergency</TabsTrigger>
                    <TabsTrigger value='shift' className='text-xs sm:text-sm'>3. Shift &amp; Working Hours</TabsTrigger>
                  </TabsList>

                  <TabsContent value='role' className='space-y-4 pt-2'>
                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                      <div className='grid gap-2'>
                        <Label>Designation</Label>
                        <SelectDropdown
                          defaultValue={basics.designationId}
                          onValueChange={(v) => setBasics({ ...basics, designationId: v })}
                          placeholder='Select designation'
                          items={(designations || []).map((d: any) => ({ label: d.name, value: d.id }))}
                          isControlled
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Department</Label>
                        <SelectDropdown
                          defaultValue={basics.departmentId}
                          onValueChange={(v) => setBasics({ ...basics, departmentId: v })}
                          placeholder='Select department'
                          items={(departments?.data || []).map((d: any) => ({ label: d.name, value: d.id }))}
                          isControlled
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Access Preset</Label>
                        <SelectDropdown
                          defaultValue={basics.accessPresetId}
                          onValueChange={(v) => setBasics({ ...basics, accessPresetId: v })}
                          placeholder='Select preset'
                          items={(presets?.data || []).map((p: any) => ({ label: p.name, value: p.id }))}
                          isControlled
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Employment Type</Label>
                        <SelectDropdown
                          defaultValue={basics.employmentType}
                          onValueChange={(v) => setBasics({ ...basics, employmentType: v as EmploymentType })}
                          placeholder='Select type'
                          items={EMPLOYMENT_TYPES}
                          isControlled
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Joining Date *</Label>
                        <DatePicker
                          selected={basics.joiningDate}
                          onSelect={(d) => setBasics({ ...basics, joiningDate: d })}
                          placeholder='Pick joining date (required)'
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Attendance Method</Label>
                        <SelectDropdown
                          defaultValue={basics.attendanceMethod}
                          onValueChange={(v) => setBasics({ ...basics, attendanceMethod: v as AttendanceMethod })}
                          placeholder='Not set'
                          items={ATTENDANCE_METHODS}
                          isControlled
                        />
                      </div>
                      <div className='col-span-1 sm:col-span-2 grid gap-2'>
                        <Label>Reporting Manager</Label>
                        <SearchableSelect
                          options={(allEmployees || []).map((e: any) => ({
                            id: e.id,
                            label: `${e.employeeId} · ${e.betterAuthUser?.name || '—'}`,
                          }))}
                          value={basics.reportingToId}
                          onChange={(v) => setBasics({ ...basics, reportingToId: v })}
                          placeholder='Select reporting manager'
                          emptyMessage='No employees found'
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value='personal' className='space-y-4 pt-2'>
                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                      <div className='grid gap-2'>
                        <Label>Confirmation Date</Label>
                        <DatePicker
                          selected={basics.confirmationDate}
                          onSelect={(d) => setBasics({ ...basics, confirmationDate: d })}
                          placeholder='Pick confirmation date'
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Date of Birth</Label>
                        <DatePicker
                          selected={personal.dateOfBirth}
                          onSelect={(d) => setPersonal({ ...personal, dateOfBirth: d })}
                          placeholder='Pick birth date'
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Gender</Label>
                        <SelectDropdown
                          defaultValue={personal.gender}
                          onValueChange={(v) => setPersonal({ ...personal, gender: v as EmployeeGender })}
                          placeholder='Select gender'
                          items={GENDER_OPTIONS}
                          isControlled
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>Nationality</Label>
                        <Input
                          value={personal.nationality}
                          onChange={(e) => setPersonal({ ...personal, nationality: e.target.value })}
                          placeholder='e.g. Bangladeshi'
                        />
                      </div>
                      <div className='grid gap-2'>
                        <Label>NID / Smart Card / Passport</Label>
                        <Input
                          value={personal.nidNumber}
                          onChange={(e) => setPersonal({ ...personal, nidNumber: e.target.value })}
                          placeholder='e.g. 1990123456789'
                        />
                      </div>
                      <div className='col-span-1 sm:col-span-2 grid gap-2'>
                        <Label>Present Address</Label>
                        <Textarea
                          rows={2}
                          value={personal.presentAddress}
                          onChange={(e) => setPersonal({ ...personal, presentAddress: e.target.value })}
                          placeholder='Current living address'
                        />
                      </div>
                      <div className='col-span-1 sm:col-span-2 grid gap-2'>
                        <Label>Permanent Address</Label>
                        <Textarea
                          rows={2}
                          value={personal.permanentAddress}
                          onChange={(e) => setPersonal({ ...personal, permanentAddress: e.target.value })}
                          placeholder='Permanent hometown address'
                        />
                      </div>
                    </div>

                    <div className='rounded-lg border p-4 bg-muted/20 space-y-3 mt-4'>
                      <div className='flex items-center gap-2'>
                        <PhoneCall className='h-4 w-4 text-primary' />
                        <h4 className='text-sm font-semibold'>Emergency Contact Information</h4>
                      </div>
                      <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
                        <div className='grid gap-2'>
                          <Label className='text-xs'>Contact Name</Label>
                          <Input
                            value={personal.emergencyContactName}
                            onChange={(e) => setPersonal({ ...personal, emergencyContactName: e.target.value })}
                            placeholder='e.g. Rahim Ahmed'
                          />
                        </div>
                        <div className='grid gap-2'>
                          <Label className='text-xs'>Phone Number</Label>
                          <Input
                            value={personal.emergencyContactPhone}
                            onChange={(e) => setPersonal({ ...personal, emergencyContactPhone: e.target.value })}
                            placeholder='017XXXXXXXX'
                          />
                        </div>
                        <div className='grid gap-2'>
                          <Label className='text-xs'>Relationship</Label>
                          <Input
                            value={personal.emergencyContactRelation}
                            onChange={(e) => setPersonal({ ...personal, emergencyContactRelation: e.target.value })}
                            placeholder='e.g. Spouse / Father'
                          />
                        </div>
                      </div>
                    </div>

                    <div className='grid gap-2 mt-4'>
                      <Label>Administrative Notes (optional)</Label>
                      <Textarea
                        rows={2}
                        value={personal.notes}
                        onChange={(e) => setPersonal({ ...personal, notes: e.target.value })}
                        placeholder='Any confidential notes or onboarding remarks'
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value='shift' className='space-y-4 pt-2'>
                    <div className='flex items-center justify-between rounded-lg border p-3 bg-muted/20'>
                      <div>
                        <p className='text-sm font-medium'>Assign Shift Schedule</p>
                        <p className='text-xs text-muted-foreground'>
                          Configure working hours and shift presets for attendance derivation.
                        </p>
                      </div>
                      <Switch checked={enableShiftAssignment} onCheckedChange={setEnableShiftAssignment} />
                    </div>
                    {enableShiftAssignment && (
                      <ShiftAssignmentPicker value={shiftValue} onChange={setShiftValue} />
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <div className='flex justify-end'>
              <Button disabled={!basicsValid} onClick={() => setStep('compensation')}>
                Continue <ArrowRight className='h-4 w-4 ml-1' />
              </Button>
            </div>
          </>
        )}

        {step === 'compensation' && selectedUser && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Step 3 — Compensation</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex items-center justify-between rounded-lg border p-3'>
                  <div>
                    <p className='text-sm font-medium'>Set a salary structure now</p>
                    <p className='text-xs text-muted-foreground'>You can also add one later from the employee detail page.</p>
                  </div>
                  <Switch checked={addSalary} onCheckedChange={setAddSalary} />
                </div>
                {addSalary && (
                  <div className='grid gap-4'>
                    <div className='grid gap-2'>
                      <Label>Effective From *</Label>
                      <DatePicker
                        selected={salary.effectiveFrom}
                        onSelect={(d) => setSalary({ ...salary, effectiveFrom: d })}
                        placeholder='Pick effective date'
                      />
                    </div>
                    <div className='grid grid-cols-2 gap-4'>
                      {SALARY_FIELDS.slice(0, 5).map((f) => (
                        <div className='grid gap-2' key={f.key}>
                          <Label>{f.label}</Label>
                          <Input type='number' min={0} value={String(salary[f.key] ?? '')} onChange={(e) => setSalary({ ...salary, [f.key]: e.target.value })} />
                        </div>
                      ))}
                    </div>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Deductions</p>
                    <div className='grid grid-cols-2 gap-4'>
                      {SALARY_FIELDS.slice(5).map((f) => (
                        <div className='grid gap-2' key={f.key}>
                          <Label>{f.label}</Label>
                          <Input type='number' min={0} value={String(salary[f.key] ?? '')} onChange={(e) => setSalary({ ...salary, [f.key]: e.target.value })} />
                        </div>
                      ))}
                    </div>
                    {netSalary !== null && (
                      <div className='rounded-lg border bg-muted/40 p-3 flex items-center justify-between'>
                        <span className='text-sm font-medium text-muted-foreground'>Estimated net salary</span>
                        <span className='text-lg font-bold tabular-nums'>{currency(netSalary)} ৳</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <div className='flex justify-between'>
              <Button variant='outline' onClick={() => setStep('basics')}>
                <ArrowLeft className='h-4 w-4 mr-1' /> Back
              </Button>
              <Button disabled={!salaryValid} onClick={() => setStep('bank')}>
                Continue <ArrowRight className='h-4 w-4 ml-1' />
              </Button>
            </div>
          </>
        )}

        {step === 'bank' && selectedUser && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Step 4 — Bank Account <span className='text-muted-foreground font-normal'>(optional)</span></CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex items-center justify-between rounded-lg border p-3'>
                  <div>
                    <p className='text-sm font-medium'>Add a bank account now</p>
                    <p className='text-xs text-muted-foreground'>You can also add one later from the employee detail page.</p>
                  </div>
                  <Switch checked={addBank} onCheckedChange={setAddBank} />
                </div>
                {addBank && (
                  <div className='grid grid-cols-2 gap-4'>
                    <div className='grid gap-2'>
                      <Label>Bank Name *</Label>
                      <Input value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} placeholder='e.g. DBBL' />
                    </div>
                    <div className='grid gap-2'>
                      <Label>Branch Name</Label>
                      <Input value={bank.branchName} onChange={(e) => setBank({ ...bank, branchName: e.target.value })} placeholder='e.g. Gulshan' />
                    </div>
                    <div className='grid gap-2'>
                      <Label>Account Number *</Label>
                      <Input value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })} placeholder='Account number' />
                    </div>
                    <div className='grid gap-2'>
                      <Label>Account Name</Label>
                      <Input value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value })} placeholder={selectedUser.name} />
                    </div>
                    <div className='grid gap-2'>
                      <Label>Account Type</Label>
                      <SelectDropdown
                        defaultValue={bank.accountType}
                        onValueChange={(v) => setBank({ ...bank, accountType: v as BankAccountType })}
                        placeholder='Select type'
                        items={BANK_TYPES}
                        isControlled
                      />
                    </div>
                    <div className='grid gap-2'>
                      <Label>Routing Number</Label>
                      <Input value={bank.routingNumber} onChange={(e) => setBank({ ...bank, routingNumber: e.target.value })} />
                    </div>
                    <div className='flex items-center justify-between col-span-2 rounded-lg border p-3'>
                      <div>
                        <p className='text-sm font-medium'>Primary account</p>
                        <p className='text-xs text-muted-foreground'>First account is primary by default.</p>
                      </div>
                      <Switch checked={bank.isPrimary} onCheckedChange={(v) => setBank({ ...bank, isPrimary: v })} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            <div className='flex justify-between'>
              <Button variant='outline' onClick={() => setStep('compensation')}>
                <ArrowLeft className='h-4 w-4 mr-1' /> Back
              </Button>
              <Button disabled={!bankValid} onClick={() => setStep('review')}>
                Continue <ArrowRight className='h-4 w-4 ml-1' />
              </Button>
            </div>
          </>
        )}

        {step === 'review' && selectedUser && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Review &amp; Create</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='rounded-lg border p-3 bg-muted/20'>
                  <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>User</p>
                  <p className='mt-1 text-sm font-medium'>{selectedUser.name} <span className='text-muted-foreground'>{selectedUser.email}</span></p>
                </div>
                <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3'>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Joining Date</p>
                    <p className='mt-1 text-sm font-medium'>{basics.joiningDate?.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                  </div>
                  {basics.confirmationDate && (
                    <div className='rounded-lg border p-3'>
                      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Confirmation Date</p>
                      <p className='mt-1 text-sm font-medium'>{basics.confirmationDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                    </div>
                  )}
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Employment Type</p>
                    <p className='mt-1 text-sm font-medium'>{EMPLOYMENT_TYPES.find((t) => t.value === basics.employmentType)?.label}</p>
                  </div>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Attendance Method</p>
                    <p className='mt-1 text-sm font-medium'>{ATTENDANCE_METHODS.find((a) => a.value === basics.attendanceMethod)?.label || 'Not set'}</p>
                  </div>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Department</p>
                    <p className='mt-1 text-sm font-medium'>{departmentName || '—'}</p>
                  </div>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Designation</p>
                    <p className='mt-1 text-sm font-medium'>{designationName || '—'}</p>
                  </div>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Access Preset</p>
                    <p className='mt-1 text-sm font-medium'>{presetName || '—'}</p>
                  </div>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Reporting Manager</p>
                    <p className='mt-1 text-sm font-medium'>{managerName || '—'}</p>
                  </div>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Assigned Shift</p>
                    <p className='mt-1 text-sm font-medium'>
                      {!enableShiftAssignment
                        ? 'Not configured'
                        : shiftValue.mode === 'template'
                          ? `${selectedShiftPreset ? `${selectedShiftPreset.name} (${selectedShiftPreset.startTime}–${selectedShiftPreset.endTime})` : 'Preset Template'} [${shiftValue.templateDays.map((d) => DAY_NAMES[d]).join(', ')}]`
                          : shiftValue.mode === 'custom'
                            ? `Custom (${shiftValue.customStartTime}–${shiftValue.customEndTime}) [${shiftValue.customDays.map((d) => DAY_NAMES[d]).join(', ')}]`
                            : 'Day-by-Day Rotation'}
                    </p>
                  </div>
                  {(personal.gender || personal.dateOfBirth || personal.nidNumber) && (
                    <div className='rounded-lg border p-3 col-span-1 sm:col-span-2'>
                      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Personal Details</p>
                      <p className='mt-1 text-sm font-medium'>
                        {[
                          personal.gender ? GENDER_LABELS[personal.gender as EmployeeGender] : null,
                          personal.dateOfBirth ? `DOB: ${personal.dateOfBirth.toLocaleDateString()}` : null,
                          personal.nidNumber ? `NID: ${personal.nidNumber}` : null,
                          personal.nationality ? personal.nationality : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  )}
                  {personal.emergencyContactName && (
                    <div className='rounded-lg border p-3'>
                      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Emergency Contact</p>
                      <p className='mt-1 text-sm font-medium'>
                        {personal.emergencyContactName} ({personal.emergencyContactPhone || '—'}) {personal.emergencyContactRelation ? `· ${personal.emergencyContactRelation}` : ''}
                      </p>
                    </div>
                  )}
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Net Salary</p>
                    <p className='mt-1 text-sm font-medium'>{netSalary !== null ? `${currency(netSalary)} ৳` : 'Not set'}</p>
                  </div>
                  <div className='rounded-lg border p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>Bank Account</p>
                    <p className='mt-1 text-sm font-medium'>
                      {addBank && bank.bankName ? `${bank.bankName} · ${bank.accountNumber}` : 'Not set'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <div className='flex justify-between'>
              <Button variant='outline' onClick={() => setStep('bank')}>
                <ArrowLeft className='h-4 w-4 mr-1' /> Back
              </Button>
              <div className='flex gap-2'>
                <Button variant='outline' onClick={() => navigate({ to: '/hr/employees' })}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <Loader2 className='h-4 w-4 animate-spin mr-1' /> : <Check className='h-4 w-4 mr-1' />}
                  Create Employee
                </Button>
              </div>
            </div>
          </>
        )}
      </Main>
    </>
  )
}
