import { useState } from 'react'
import { Loader2, Pencil, Plus, RotateCcw } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'
import { PageInfo } from '@/components/page-info'
import {
  JOB_POSTING_STATUSES,
  type CreateJobPostingDto,
  type JobPostingResponse,
} from './api'
import {
  useCreatePostingMutation,
  useJobPostingsQuery,
  useUpdatePostingMutation,
} from './hooks'
import { JobPostingFormDialog } from './components/job-posting-form'

const STATUS_BADGE: Record<JobPostingResponse['status'], string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  PUBLISHED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  CLOSED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

function formatDeadline(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function salaryLabel(posting: JobPostingResponse): string {
  if (posting.salaryDisplay) return posting.salaryDisplay
  if (posting.salaryMin !== null && posting.salaryMax !== null) {
    return `৳${posting.salaryMin.toLocaleString()}–${posting.salaryMax.toLocaleString()}`
  }
  if (posting.salaryMin !== null) return `৳${posting.salaryMin.toLocaleString()}+`
  if (posting.salaryMax !== null) return `Up to ৳${posting.salaryMax.toLocaleString()}`
  return '—'
}

export function CareersPostingsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<JobPostingResponse | null>(null)

  const { data, isLoading, isError, refetch } = useJobPostingsQuery({
    status: statusFilter === 'all' ? undefined : statusFilter,
    perPage: 50,
  })
  const createMut = useCreatePostingMutation()
  const updateMut = useUpdatePostingMutation()

  const rows = data?.data ?? []
  const saving = createMut.isPending || updateMut.isPending

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(posting: JobPostingResponse) {
    setEditing(posting)
    setFormOpen(true)
  }

  function handleSubmit(dto: CreateJobPostingDto) {
    if (editing) {
      updateMut.mutate({ id: editing.id, dto }, { onSuccess: () => setFormOpen(false) })
    } else {
      createMut.mutate(dto, { onSuccess: () => setFormOpen(false) })
    }
  }

  function setStatus(posting: JobPostingResponse, status: JobPostingResponse['status']) {
    updateMut.mutate({ id: posting.id, dto: { status } })
  }

  return (
    <>
      <Header fixed>
        <div className="me-auto" />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              Careers — Job Postings
              <PageInfo text="Create roles, publish them to the storefront, and close them when hiring ends. Only published roles with a future deadline accept applications." />
            </h1>
            <p className="text-sm text-muted-foreground">
              Roles published on the storefront Careers page.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Posting
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Postings</CardTitle>
                <CardDescription>{data?.meta.total ?? 0} postings</CardDescription>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {JOB_POSTING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="py-16 text-center">
                <p className="text-sm text-muted-foreground">Could not load job postings.</p>
                <Button variant="outline" className="mt-4" onClick={() => refetch()}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Retry
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center">
                <p className="font-medium">No job postings yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create your first posting — it stays a draft until you publish it.
                </p>
                <Button className="mt-4" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" /> New Posting
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Salary</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Applications</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((posting) => (
                    <TableRow key={posting.id}>
                      <TableCell className="font-medium">{posting.title}</TableCell>
                      <TableCell>{posting.department?.name ?? '—'}</TableCell>
                      <TableCell>{posting.location}</TableCell>
                      <TableCell>{posting.employmentType}</TableCell>
                      <TableCell>{salaryLabel(posting)}</TableCell>
                      <TableCell>{formatDeadline(posting.deadline)}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_BADGE[posting.status]}>{posting.status}</Badge>
                      </TableCell>
                      <TableCell>{posting._count?.applications ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => openEdit(posting)}>
                            <Pencil className="mr-1 h-3 w-3" /> Edit
                          </Button>
                          {posting.status === 'DRAFT' && (
                            <Button size="sm" onClick={() => setStatus(posting, 'PUBLISHED')}>
                              Publish
                            </Button>
                          )}
                          {posting.status === 'PUBLISHED' && (
                            <Button size="sm" variant="outline" onClick={() => setStatus(posting, 'DRAFT')}>
                              Unpublish
                            </Button>
                          )}
                          {posting.status !== 'CLOSED' && (
                            <Button size="sm" variant="outline" onClick={() => setStatus(posting, 'CLOSED')}>
                              Close
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Main>

      <JobPostingFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        posting={editing}
        onSubmit={handleSubmit}
        isSaving={saving}
      />
    </>
  )
}

export { CareersApplicationsPage } from './applications'
