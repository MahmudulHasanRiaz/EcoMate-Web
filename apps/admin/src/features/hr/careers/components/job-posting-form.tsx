import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { departmentsApi } from '@/features/departments/api'
import { designationsApi } from '@/features/designations/api'
import {
  EMPLOYMENT_TYPES,
  JOB_POSTING_STATUSES,
  type CreateJobPostingDto,
  type JobPostingResponse,
} from '../api'

function toDateInput(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function emptyForm(): CreateJobPostingDto {
  return {
    title: '',
    departmentId: null,
    designationId: null,
    location: '',
    employmentType: 'Full-time',
    salaryMin: null,
    salaryMax: null,
    salaryDisplay: '',
    description: '',
    requirements: '',
    responsibilities: '',
    benefits: [],
    deadline: null,
    status: 'DRAFT',
    sortOrder: 0,
  }
}

function fromPosting(posting: JobPostingResponse): CreateJobPostingDto {
  return {
    title: posting.title,
    departmentId: posting.departmentId,
    designationId: posting.designationId,
    location: posting.location,
    employmentType: posting.employmentType,
    salaryMin: posting.salaryMin,
    salaryMax: posting.salaryMax,
    salaryDisplay: posting.salaryDisplay ?? '',
    description: posting.description,
    requirements: posting.requirements ?? '',
    responsibilities: posting.responsibilities ?? '',
    benefits: posting.benefits ?? [],
    deadline: toDateInput(posting.deadline),
    status: posting.status,
    sortOrder: posting.sortOrder,
  }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  posting: JobPostingResponse | null
  onSubmit: (dto: CreateJobPostingDto) => void
  isSaving: boolean
}

export function JobPostingFormDialog({ open, onOpenChange, posting, onSubmit, isSaving }: Props) {
  const [form, setForm] = useState<CreateJobPostingDto>(emptyForm())
  const [benefitsText, setBenefitsText] = useState('')
  const [error, setError] = useState('')

  const { data: departmentsPage } = useQuery({
    queryKey: ['departments', { isActive: true }],
    queryFn: () => departmentsApi.list({ isActive: true }).then((r) => r.data),
    enabled: open,
  })
  const { data: designations } = useQuery({
    queryKey: ['designations'],
    queryFn: () => designationsApi.list().then((r) => r.data),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    if (posting) {
      setForm(fromPosting(posting))
      setBenefitsText((posting.benefits ?? []).join('\n'))
    } else {
      setForm(emptyForm())
      setBenefitsText('')
    }
    setError('')
  }, [open, posting])

  const set = <K extends keyof CreateJobPostingDto>(key: K, value: CreateJobPostingDto[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  function handleSave() {
    if (!form.title.trim()) return setError('Title is required')
    if (!form.location.trim()) return setError('Location is required')
    if (!form.description.trim()) return setError('Description is required')
    if (
      form.salaryMin !== null && form.salaryMin !== undefined &&
      form.salaryMax !== null && form.salaryMax !== undefined &&
      form.salaryMax < form.salaryMin
    ) {
      return setError('Maximum salary must not be less than minimum salary')
    }
    onSubmit({
      ...form,
      title: form.title.trim(),
      location: form.location.trim(),
      description: form.description.trim(),
      salaryDisplay: form.salaryDisplay?.trim() || null,
      requirements: form.requirements?.trim() || null,
      responsibilities: form.responsibilities?.trim() || null,
      benefits: benefitsText.split('\n').map((b) => b.trim()).filter(Boolean),
      deadline: form.deadline?.trim() ? form.deadline : null,
    })
  }

  const departments = departmentsPage?.data ?? []
  const activeDesignations = (designations ?? []).filter((d) => d.isActive)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{posting ? 'Edit Job Posting' : 'Create Job Posting'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="careers-title">Title *</Label>
            <Input
              id="careers-title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Senior Quality Inspector"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Department</Label>
              <Select
                value={form.departmentId ?? 'none'}
                onValueChange={(v) => set('departmentId', v === 'none' ? null : v)}
              >
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No department</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Designation</Label>
              <Select
                value={form.designationId ?? 'none'}
                onValueChange={(v) => set('designationId', v === 'none' ? null : v)}
              >
                <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No designation</SelectItem>
                  {activeDesignations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="careers-location">Location *</Label>
              <Input
                id="careers-location"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="e.g. Dhaka"
              />
            </div>
            <div className="grid gap-2">
              <Label>Employment Type</Label>
              <Select
                value={form.employmentType}
                onValueChange={(v) => set('employmentType', v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="careers-salary-min">Minimum Salary (৳)</Label>
              <Input
                id="careers-salary-min"
                type="number"
                min={0}
                value={form.salaryMin ?? ''}
                onChange={(e) => set('salaryMin', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="careers-salary-max">Maximum Salary (৳)</Label>
              <Input
                id="careers-salary-max"
                type="number"
                min={0}
                value={form.salaryMax ?? ''}
                onChange={(e) => set('salaryMax', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="careers-salary-display">Salary Display</Label>
              <Input
                id="careers-salary-display"
                value={form.salaryDisplay ?? ''}
                onChange={(e) => set('salaryDisplay', e.target.value)}
                placeholder="e.g. Competitive"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="careers-description">Description *</Label>
            <Textarea
              id="careers-description"
              rows={5}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What this role does, day to day."
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="careers-requirements">Requirements</Label>
            <Textarea
              id="careers-requirements"
              rows={4}
              value={form.requirements ?? ''}
              onChange={(e) => set('requirements', e.target.value)}
              placeholder="Skills, experience and qualifications."
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="careers-responsibilities">Responsibilities</Label>
            <Textarea
              id="careers-responsibilities"
              rows={4}
              value={form.responsibilities ?? ''}
              onChange={(e) => set('responsibilities', e.target.value)}
              placeholder="Key responsibilities of the role."
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="careers-benefits">Benefits (one per line)</Label>
            <Textarea
              id="careers-benefits"
              rows={3}
              value={benefitsText}
              onChange={(e) => setBenefitsText(e.target.value)}
              placeholder={'Festival bonus\nHealth insurance'}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="careers-deadline">Application Deadline</Label>
              <Input
                id="careers-deadline"
                type="date"
                value={form.deadline ?? ''}
                onChange={(e) => set('deadline', e.target.value || null)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set('status', v as CreateJobPostingDto['status'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JOB_POSTING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="careers-sort">Sort Order</Label>
              <Input
                id="careers-sort"
                type="number"
                value={form.sortOrder ?? 0}
                onChange={(e) => set('sortOrder', Number(e.target.value) || 0)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : posting ? 'Save Changes' : 'Create Posting'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
