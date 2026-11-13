import { useEffect, useState } from 'react'
import { Download, FileText, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { careersApi, NEXT_APPLICATION_STATUSES, type JobApplicationResponse } from '../api'
import { useDeleteCvMutation, useUpdateApplicationMutation } from '../hooks'

const STATUS_BADGE: Record<JobApplicationResponse['status'], string> = {
  NEW: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SHORTLISTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  INTERVIEW: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  HIRED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

const WORKFLOW_STEPS: JobApplicationResponse['status'][] = ['NEW', 'SHORTLISTED', 'INTERVIEW', 'HIRED']

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type Props = {
  application: JobApplicationResponse | null
  onOpenChange: (open: boolean) => void
}

export function ApplicationDetailDialog({ application, onOpenChange }: Props) {
  const [note, setNote] = useState('')
  const [confirmDeleteCv, setConfirmDeleteCv] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const updateMut = useUpdateApplicationMutation()
  const deleteCvMut = useDeleteCvMutation()

  useEffect(() => {
    setNote(application?.internalNote ?? '')
    setConfirmDeleteCv(false)
  }, [application?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!application) return null

  const nextStatuses = NEXT_APPLICATION_STATUSES[application.status]
  const stepIndex = application.status === 'REJECTED' ? -1 : WORKFLOW_STEPS.indexOf(application.status)

  async function handleDownloadCv() {
    if (!application?.cvUrl) return
    setDownloading(true)
    try {
      const blob = await careersApi.downloadCv(application.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = application.cvOriginalName || 'cv.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={!!application} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{application.fullName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Status stepper */}
          <div>
            <div className="flex items-center gap-1">
              {WORKFLOW_STEPS.map((step, i) => (
                <div key={step} className="flex flex-1 items-center gap-1">
                  <div
                    className={`flex h-7 flex-1 items-center justify-center rounded-full text-[11px] font-semibold ${
                      stepIndex >= i
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step}
                  </div>
                  {i < WORKFLOW_STEPS.length - 1 && <div className="h-px w-2 bg-border" />}
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Current status:</span>
              <Badge className={STATUS_BADGE[application.status]}>{application.status}</Badge>
              {application.reviewedAt && (
                <span className="text-xs text-muted-foreground">
                  Last updated {formatDateTime(application.reviewedAt)}
                </span>
              )}
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Role</p>
              <p className="font-medium">{application.jobPosting?.title ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Applied</p>
              <p className="font-medium">{formatDate(application.createdAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email</p>
              <a className="font-medium text-primary hover:underline" href={`mailto:${application.email}`}>
                {application.email}
              </a>
            </div>
            <div>
              <p className="text-muted-foreground">Phone</p>
              <a className="font-medium text-primary hover:underline" href={`tel:${application.phone}`}>
                {application.phone}
              </a>
            </div>
            {application.portfolioUrl && (
              <div className="col-span-2">
                <p className="text-muted-foreground">Portfolio</p>
                <a
                  className="font-medium text-primary hover:underline break-all"
                  href={application.portfolioUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {application.portfolioUrl}
                </a>
              </div>
            )}
          </div>

          {/* Cover letter */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">Cover Letter</p>
            <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">
              {application.coverLetter || 'No cover letter provided.'}
            </p>
          </div>

          {/* CV */}
          <div>
            <p className="text-sm text-muted-foreground mb-2">CV</p>
            {application.cvUrl ? (
              <div className="flex items-center gap-3 rounded-md border p-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">
                  {application.cvOriginalName || 'CV'}
                </span>
                <Button size="sm" variant="outline" onClick={handleDownloadCv} disabled={downloading}>
                  <Download className="mr-1 h-4 w-4" />
                  {downloading ? 'Downloading…' : 'Download'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setConfirmDeleteCv(true)}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete CV
                </Button>
              </div>
            ) : (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                CV deleted
                {application.cvDeletedAt ? ` on ${formatDateTime(application.cvDeletedAt)}` : ''}.
                The application record is kept.
              </p>
            )}
          </div>

          {/* Status actions */}
          {nextStatuses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map((status) => (
                <Button
                  key={status}
                  size="sm"
                  variant={status === 'REJECTED' ? 'destructive' : 'default'}
                  disabled={updateMut.isPending}
                  onClick={() => updateMut.mutate({ id: application.id, dto: { status } })}
                >
                  {status === 'REJECTED' ? 'Reject' : `Move to ${status}`}
                </Button>
              ))}
            </div>
          )}

          {/* Internal note */}
          <div className="grid gap-2">
            <Label htmlFor="careers-internal-note">Internal Note</Label>
            <Textarea
              id="careers-internal-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Private note for staff — never shown to the applicant."
            />
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={updateMut.isPending || note === (application.internalNote ?? '')}
                onClick={() => updateMut.mutate({ id: application.id, dto: { internalNote: note || null } })}
              >
                Save Note
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmDeleteCv}
        onOpenChange={setConfirmDeleteCv}
        title="Delete CV?"
        desc="This permanently deletes the applicant's CV file from storage. The application record itself is kept, and this action cannot be undone."
        confirmText="Delete CV"
        destructive
        isLoading={deleteCvMut.isPending}
        handleConfirm={() => {
          deleteCvMut.mutate(application.id, {
            onSuccess: () => setConfirmDeleteCv(false),
          })
        }}
      />
    </Dialog>
  )
}
