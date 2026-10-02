import { useState, useEffect } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Briefcase,
  User,
  Wallet,
  Clock,
  Building,
  Shield,
  Loader2,
  Calendar,
  AlertCircle,
  Save,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/date-picker'
import { useDepartmentsQuery } from '@/features/departments/hooks'
import { useDesignationsQuery } from '@/features/designations/hooks'
import { useAccessPresetsQuery } from '@/features/access-presets/hooks'
import {
  employeesApi,
  type EmployeeResponse,
  type EmployeeStatus,
  type EmploymentType,
  type EmployeeGender,
  type AttendanceMethod,
  type UpdateEmployeeDto,
  STATUS_LABELS,
  GENDER_LABELS,
  ATTENDANCE_METHOD_LABELS,
} from '../api'
import {
  ShiftAssignmentPicker,
  DEFAULT_SHIFT_VALUE,
  type ShiftMode,
  type ShiftSelectionValue,
} from '@/features/hr-shifts/components/shift-assignment-picker'
import {
  useShiftRotationQuery,
  useBulkSetRotationMutation,
  useQuickAssignShiftMutation,
  useFindOrCreateCustomShiftMutation,
} from '@/features/hr-shifts/hooks'

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

interface EditEmployeeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee: EmployeeResponse | null
  onSuccess?: () => void
}

export function EditEmployeeDialog({
  open,
  onOpenChange,
  employee,
  onSuccess,
}: EditEmployeeDialogProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'employment' | 'personal' | 'compensation' | 'shift'>('employment')
  const [saving, setSaving] = useState(false)

  // Options queries
  const { data: departments } = useDepartmentsQuery()
  const { data: designations } = useDesignationsQuery()
  const { data: presets } = useAccessPresetsQuery(1, '')
  const { data: managers } = useQuery({
    queryKey: ['employees', 'manager-picker'],
    queryFn: () => employeesApi.list({ page: 1, perPage: 100, status: 'active' }).then((r) => r.data.data),
  })

  // Rotation query for this employee
  const { data: rotationData } = useShiftRotationQuery(employee?.id || '')
  const bulkSetRotationMut = useBulkSetRotationMutation(employee?.id || '')
  const quickAssignMut = useQuickAssignShiftMutation(employee?.id || '')
  const findCustomMut = useFindOrCreateCustomShiftMutation()

  // Form states
  const [form, setForm] = useState({
    // Employment & Role
    status: 'active' as EmployeeStatus,
    employmentType: 'full_time' as EmploymentType,
    departmentId: '',
    designationId: '',
    accessPresetId: '',
    reportingToId: '',
    attendanceMethod: 'APP' as AttendanceMethod,
    joiningDate: undefined as Date | undefined,
    confirmationDate: undefined as Date | undefined,
    exitDate: undefined as Date | undefined,
    exitReason: '',
    // Personal & Contact
    dateOfBirth: undefined as Date | undefined,
    gender: '' as EmployeeGender | '',
    nationality: '',
    nidNumber: '',
    presentAddress: '',
    permanentAddress: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
    notes: '',
    // Compensation
    salary: '',
    bankName: '',
    bankAccountNo: '',
  })

  const [shiftValue, setShiftValue] = useState<ShiftSelectionValue>(DEFAULT_SHIFT_VALUE)
  const [shiftDirty, setShiftDirty] = useState(false)

  // Populate when employee opens
  useEffect(() => {
    if (!employee) return

    setForm({
      status: employee.status,
      employmentType: employee.employmentType,
      departmentId: employee.departmentId || '',
      designationId: employee.designationId || '',
      accessPresetId: employee.accessPresetId || '',
      reportingToId: employee.reportingTo?.id || '',
      attendanceMethod: employee.attendanceMethod || 'APP',
      joiningDate: employee.joiningDate ? new Date(employee.joiningDate) : undefined,
      confirmationDate: employee.confirmationDate ? new Date(employee.confirmationDate) : undefined,
      exitDate: employee.exitDate ? new Date(employee.exitDate) : undefined,
      exitReason: employee.exitReason || '',
      dateOfBirth: employee.dateOfBirth ? new Date(employee.dateOfBirth) : undefined,
      gender: employee.gender || '',
      nationality: employee.nationality || '',
      nidNumber: employee.nidNumber || '',
      presentAddress: employee.presentAddress || '',
      permanentAddress: employee.permanentAddress || '',
      emergencyContactName: employee.emergencyContactName || '',
      emergencyContactPhone: employee.emergencyContactPhone || '',
      emergencyContactRelation: employee.emergencyContactRelation || '',
      notes: employee.notes || '',
      salary: employee.salary != null ? String(employee.salary) : '',
      bankName: employee.bankName || '',
      bankAccountNo: employee.bankAccountNo || '',
    })

    // Populate shift rotation
    if (rotationData?.rotation) {
      const rotMap: Record<number, string | '__none__'> = {
        0: '__none__',
        1: '__none__',
        2: '__none__',
        3: '__none__',
        4: '__none__',
        5: '__none__',
        6: '__none__',
      }
      const daysWithShifts: number[] = []
      const usedPresetIds = new Set<string>()
      for (const r of rotationData.rotation) {
        rotMap[r.dayOfWeek] = r.shift.id
        daysWithShifts.push(r.dayOfWeek)
        usedPresetIds.add(r.shift.id)
      }
      // Restore the right editing mode. Leaving it on 'template' meant a genuine
      // multi-preset rotation displayed as a template and, on save, collapsed
      // every day onto one preset — silent data loss.
      const restoredMode: ShiftMode =
        usedPresetIds.size > 1
          ? 'rotation'
          : daysWithShifts.length > 0
            ? 'template'
            : DEFAULT_SHIFT_VALUE.mode
      setShiftValue({
        ...DEFAULT_SHIFT_VALUE,
        mode: restoredMode,
        presetId: usedPresetIds.values().next().value ?? DEFAULT_SHIFT_VALUE.presetId,
        templateDays: daysWithShifts.length > 0 ? daysWithShifts : [0, 1, 2, 3, 4],
        rotation: rotMap,
      })
      setShiftDirty(false)
    }
  }, [employee, rotationData])

  if (!employee) return null

  const isTerminal = form.status === 'terminated' || form.status === 'resigned'

  const handleShiftChange = (val: ShiftSelectionValue) => {
    // The picker seeds its default preset on mount. That is not a user edit, so
    // it must not flip the footer to "unsaved changes" on a dialog nobody
    // touched.
    const seededOnly =
      shiftValue.mode === val.mode &&
      shiftValue.presetId === val.presetId &&
      shiftValue.templateDays.length === val.templateDays.length &&
      shiftValue.templateDays.every((d, i) => d === val.templateDays[i]) &&
      !shiftDirty
    setShiftValue(val)
    if (!seededOnly) setShiftDirty(true)
  }

  const handleSave = async () => {
    if (!employee) return

    if (isTerminal && !form.exitDate) {
      toast.error('Exit date is required when status is Terminated or Resigned')
      setActiveTab('employment')
      return
    }

    setSaving(true)
    try {
      // 1. Update core employee record
      const updatePayload: UpdateEmployeeDto = {
        status: form.status,
        employmentType: form.employmentType,
        departmentId: form.departmentId || null,
        designationId: form.designationId || null,
        accessPresetId: form.accessPresetId || null,
        reportingToId: form.reportingToId || null,
        attendanceMethod: form.attendanceMethod || 'APP',
        joiningDate: form.joiningDate ? form.joiningDate.toISOString().slice(0, 10) : null,
        confirmationDate: form.confirmationDate ? form.confirmationDate.toISOString().slice(0, 10) : null,
        exitDate: form.exitDate ? form.exitDate.toISOString().slice(0, 10) : null,
        exitReason: form.exitReason || null,
        dateOfBirth: form.dateOfBirth ? form.dateOfBirth.toISOString().slice(0, 10) : null,
        gender: form.gender || null,
        nationality: form.nationality || null,
        nidNumber: form.nidNumber || null,
        presentAddress: form.presentAddress || null,
        permanentAddress: form.permanentAddress || null,
        emergencyContactName: form.emergencyContactName || null,
        emergencyContactPhone: form.emergencyContactPhone || null,
        emergencyContactRelation: form.emergencyContactRelation || null,
        notes: form.notes || undefined,
        salary: form.salary ? Number(form.salary) : undefined,
        bankName: form.bankName || undefined,
        bankAccountNo: form.bankAccountNo || undefined,
      }

      await employeesApi.update(employee.id, updatePayload)

      // 2. Update shifts if modified
      if (shiftDirty) {
        if (shiftValue.mode === 'template' && shiftValue.presetId) {
          await quickAssignMut.mutateAsync({
            shiftPresetId: shiftValue.presetId,
            days: shiftValue.templateDays,
          })
        } else if (shiftValue.mode === 'custom') {
          const customPreset = await findCustomMut.mutateAsync({
            startTime: shiftValue.customStartTime,
            endTime: shiftValue.customEndTime,
            graceMinutes: shiftValue.customGraceMinutes,
            breakMinutes: shiftValue.customBreakMinutes,
          })
          if (customPreset?.id) {
            await quickAssignMut.mutateAsync({
              shiftPresetId: customPreset.id,
              days: shiftValue.customDays,
            })
          }
        } else if (shiftValue.mode === 'rotation') {
          const items = Object.entries(shiftValue.rotation).map(([dayStr, presetId]) => ({
            dayOfWeek: Number(dayStr),
            shiftPresetId: presetId === '__none__' ? null : presetId,
          }))
          await bulkSetRotationMut.mutateAsync(items)
        }
      }

      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['employee', employee.id] })
      queryClient.invalidateQueries({ queryKey: ['hr-shift-rotation', employee.id] })
      toast.success('Employee profile updated successfully')
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      const msg = err.response?.data?.message
      const text = Array.isArray(msg) ? msg.join(', ') : msg || 'Error updating employee'
      toast.error(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden'>
        <DialogHeader className='px-6 pt-5 pb-3 border-b border-border/60 bg-muted/20'>
          <div className='flex items-center gap-3'>
            <div className='size-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm'>
              {employee.betterAuthUser?.name?.charAt(0) || 'E'}
            </div>
            <div>
              <DialogTitle className='text-base font-semibold'>
                Edit Employee: {employee.betterAuthUser?.name || employee.employeeId}
              </DialogTitle>
              <p className='text-xs text-muted-foreground font-mono'>
                ID: {employee.employeeId} · {employee.betterAuthUser?.email}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Tab Selection */}
        <div className='px-6 pt-2 pb-1 border-b border-border/50'>
          <Tabs value={activeTab} onValueChange={(t) => setActiveTab(t as any)}>
            <TabsList className='grid grid-cols-4 w-full h-9'>
              <TabsTrigger value='employment' className='text-xs gap-1.5'>
                <Briefcase className='size-3.5' />
                <span>Employment</span>
              </TabsTrigger>
              <TabsTrigger value='personal' className='text-xs gap-1.5'>
                <User className='size-3.5' />
                <span>Personal</span>
              </TabsTrigger>
              <TabsTrigger value='compensation' className='text-xs gap-1.5'>
                <Wallet className='size-3.5' />
                <span>Salary &amp; Bank</span>
              </TabsTrigger>
              <TabsTrigger value='shift' className='text-xs gap-1.5'>
                <Clock className='size-3.5' />
                <span>Shift</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Form Body (Scrollable) */}
        <div className='flex-1 overflow-y-auto px-6 py-4'>
          {/* TAB 1: Employment & Role */}
          {activeTab === 'employment' && (
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(val) => setForm((f) => ({ ...f, status: val as EmployeeStatus }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Select status' />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Employment Type</Label>
                  <Select
                    value={form.employmentType}
                    onValueChange={(val) => setForm((f) => ({ ...f, employmentType: val as EmploymentType }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Select type' />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Department</Label>
                  <Select
                    value={form.departmentId}
                    onValueChange={(val) => setForm((f) => ({ ...f, departmentId: val }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='No department' />
                    </SelectTrigger>
                    <SelectContent>
                      {(departments?.data || []).map((d: any) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Designation</Label>
                  <Select
                    value={form.designationId}
                    onValueChange={(val) => setForm((f) => ({ ...f, designationId: val }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='No designation' />
                    </SelectTrigger>
                    <SelectContent>
                      {(designations || []).map((d: any) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Access Preset</Label>
                  <Select
                    value={form.accessPresetId}
                    onValueChange={(val) => setForm((f) => ({ ...f, accessPresetId: val }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='No preset' />
                    </SelectTrigger>
                    <SelectContent>
                      {(presets?.data || []).map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Reporting Manager</Label>
                  <Select
                    value={form.reportingToId}
                    onValueChange={(val) => setForm((f) => ({ ...f, reportingToId: val }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='No manager' />
                    </SelectTrigger>
                    <SelectContent>
                      {(managers || [])
                        .filter((m: any) => m.id !== employee.id)
                        .map((m: any) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.betterAuthUser?.name || m.employeeId} ({m.employeeId})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Joining Date</Label>
                  <DatePicker
                    selected={form.joiningDate}
                    onSelect={(d?: Date) => setForm((f) => ({ ...f, joiningDate: d }))}
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Confirmation Date</Label>
                  <DatePicker
                    selected={form.confirmationDate}
                    onSelect={(d?: Date) => setForm((f) => ({ ...f, confirmationDate: d }))}
                  />
                </div>

                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs'>Attendance Method</Label>
                  <Select
                    value={form.attendanceMethod}
                    onValueChange={(val) => setForm((f) => ({ ...f, attendanceMethod: val as AttendanceMethod }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Select attendance method' />
                    </SelectTrigger>
                    <SelectContent>
                      {ATTENDANCE_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isTerminal && (
                <div className='p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-3'>
                  <div className='flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-semibold'>
                    <AlertCircle className='size-4' />
                    <span>Exit Details Required ({STATUS_LABELS[form.status]})</span>
                  </div>
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>Exit Date *</Label>
                      <DatePicker
                        selected={form.exitDate}
                        onSelect={(d?: Date) => setForm((f) => ({ ...f, exitDate: d }))}
                      />
                    </div>
                    <div className='space-y-1.5'>
                      <Label className='text-xs'>Exit Reason</Label>
                      <Input
                        value={form.exitReason}
                        onChange={(e) => setForm((f) => ({ ...f, exitReason: e.target.value }))}
                        placeholder='Reason for departure'
                        className='h-9 text-xs'
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Personal & Contact */}
          {activeTab === 'personal' && (
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Date of Birth</Label>
                  <DatePicker
                    selected={form.dateOfBirth}
                    onSelect={(d?: Date) => setForm((f) => ({ ...f, dateOfBirth: d }))}
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Gender</Label>
                  <Select
                    value={form.gender}
                    onValueChange={(val) => setForm((f) => ({ ...f, gender: val as EmployeeGender }))}
                  >
                    <SelectTrigger className='h-9 text-xs'>
                      <SelectValue placeholder='Select gender' />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(GENDER_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Nationality</Label>
                  <Input
                    value={form.nationality}
                    onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}
                    placeholder='e.g. Bangladeshi'
                    className='h-9 text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>NID / Smart Card Number</Label>
                  <Input
                    value={form.nidNumber}
                    onChange={(e) => setForm((f) => ({ ...f, nidNumber: e.target.value }))}
                    placeholder='National ID'
                    className='h-9 text-xs font-mono'
                  />
                </div>

                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs'>Present Address</Label>
                  <Textarea
                    value={form.presentAddress}
                    onChange={(e) => setForm((f) => ({ ...f, presentAddress: e.target.value }))}
                    placeholder='Current residential address'
                    rows={2}
                    className='text-xs'
                  />
                </div>

                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs'>Permanent Address</Label>
                  <Textarea
                    value={form.permanentAddress}
                    onChange={(e) => setForm((f) => ({ ...f, permanentAddress: e.target.value }))}
                    placeholder='Permanent home address'
                    rows={2}
                    className='text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Emergency Contact Name</Label>
                  <Input
                    value={form.emergencyContactName}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactName: e.target.value }))}
                    placeholder='Contact person name'
                    className='h-9 text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Emergency Contact Phone</Label>
                  <Input
                    value={form.emergencyContactPhone}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactPhone: e.target.value }))}
                    placeholder='e.g. +8801700000000'
                    className='h-9 text-xs font-mono'
                  />
                </div>

                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs'>Emergency Contact Relation</Label>
                  <Input
                    value={form.emergencyContactRelation}
                    onChange={(e) => setForm((f) => ({ ...f, emergencyContactRelation: e.target.value }))}
                    placeholder='e.g. Spouse, Father, Brother'
                    className='h-9 text-xs'
                  />
                </div>

                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs'>Internal HR Notes</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder='Private administrative notes'
                    rows={2}
                    className='text-xs'
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Compensation & Bank */}
          {activeTab === 'compensation' && (
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <Label className='text-xs'>Base Salary (৳)</Label>
                  <Input
                    type='number'
                    value={form.salary}
                    onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))}
                    placeholder='e.g. 35000'
                    className='h-9 text-xs tabular-nums'
                  />
                  <p className='text-[11px] text-muted-foreground'>
                    Primary salary figure. Use the Compensation tab on the detail page to configure detailed allowances and deductions.
                  </p>
                </div>

                <div className='space-y-1.5'>
                  <Label className='text-xs'>Bank Name</Label>
                  <Input
                    value={form.bankName}
                    onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder='e.g. BRAC Bank PLC'
                    className='h-9 text-xs'
                  />
                </div>

                <div className='space-y-1.5 sm:col-span-2'>
                  <Label className='text-xs'>Bank Account Number</Label>
                  <Input
                    value={form.bankAccountNo}
                    onChange={(e) => setForm((f) => ({ ...f, bankAccountNo: e.target.value }))}
                    placeholder='e.g. 1501201234567001'
                    className='h-9 text-xs font-mono'
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Shift & Schedule */}
          {activeTab === 'shift' && (
            <div className='space-y-3'>
              <ShiftAssignmentPicker
                value={shiftValue}
                onChange={handleShiftChange}
                disabled={saving}
              />
            </div>
          )}
        </div>

        <DialogFooter className='px-6 py-3 border-t border-border/60 bg-muted/20 flex items-center justify-between sm:justify-between'>
          <p className='text-[11px] text-muted-foreground'>
            {shiftDirty ? 'Shift assignment has unsaved changes' : 'Employee details and shifts save together'}
          </p>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button size='sm' disabled={saving} onClick={handleSave} className='gap-1.5'>
              {saving ? <Loader2 className='size-3.5 animate-spin' /> : <Save className='size-3.5' />}
              <span>Save Changes</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
