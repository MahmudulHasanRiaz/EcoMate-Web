import { useState } from 'react'
import { Eye, Loader2, RotateCcw } from 'lucide-react'
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
  JOB_APPLICATION_STATUSES,
  type JobApplicationResponse,
} from './api'
import { useJobApplicationsQuery, useJobPostingsQuery } from './hooks'
import { ApplicationDetailDialog } from './components/application-detail-dialog'

const STATUS_BADGE: Record<JobApplicationResponse['status'], string> = {
  NEW: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SHORTLISTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  INTERVIEW: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  HIRED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function CareersApplicationsPage() {
  const [jobFilter, setJobFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selected, setSelected] = useState<JobApplicationResponse | null>(null)

  const { data: postings } = useJobPostingsQuery({ perPage: 100 })
  const { data, isLoading, isError, refetch } = useJobApplicationsQuery({
    jobId: jobFilter === 'all' ? undefined : jobFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
    perPage: 50,
  })

  const rows = data?.data ?? []

  return (
    <>
      <Header fixed>
        <div className="me-auto" />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main>
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            Careers — Applications
            <PageInfo text="Every application moves NEW → SHORTLISTED → INTERVIEW → HIRED, or is rejected. Each change records who made it and when." />
          </h1>
          <p className="text-sm text-muted-foreground">
            Review applications, move candidates through the pipeline, and manage CVs.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <CardTitle>Applications</CardTitle>
                <CardDescription>{data?.meta.total ?? 0} applications</CardDescription>
              </div>
              <div className="flex gap-2">
                <Select value={jobFilter} onValueChange={setJobFilter}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="All jobs" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All jobs</SelectItem>
                    {(postings?.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {JOB_APPLICATION_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="py-16 text-center">
                <p className="text-sm text-muted-foreground">Could not load applications.</p>
                <Button variant="outline" className="mt-4" onClick={() => refetch()}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Retry
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center">
                <p className="font-medium">No applications yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Applications appear here once visitors apply to a published role.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Applicant</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>CV</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="font-medium">{app.fullName}</TableCell>
                      <TableCell>{app.jobPosting?.title ?? '—'}</TableCell>
                      <TableCell>
                        <div className="text-sm">{app.email}</div>
                        <div className="text-xs text-muted-foreground">{app.phone}</div>
                      </TableCell>
                      <TableCell>{formatDate(app.createdAt)}</TableCell>
                      <TableCell>{app.cvUrl ? 'Attached' : 'Deleted'}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_BADGE[app.status]}>{app.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelected(app)}>
                          <Eye className="mr-1 h-3 w-3" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Main>

      <ApplicationDetailDialog
        application={selected}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
      />
    </>
  )
}
