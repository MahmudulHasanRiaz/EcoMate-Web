import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useBackups, useTriggerBackup, useRestoreBackup,
  useUploadBackup, useToggleLock, useDeleteBackup } from './hooks'
import { BackupTable } from './components/BackupTable'
import { BackupStats } from './components/BackupStats'
import { RunBackupDialog } from './components/RunBackupDialog'
import { UploadRestoreDialog } from './components/UploadRestoreDialog'
import { backupApi } from './api'

export function BackupPage() {
  const [page, setPage] = useState(1)
  const [createdBackupId, setCreatedBackupId] = useState<string | null>(null)
  const { data, isLoading } = useBackups({ page, limit: 20 })
  const trigger = useTriggerBackup()
  const restore = useRestoreBackup()
  const uploadBackup = useUploadBackup()
  const toggleLock = useToggleLock()
  const deleteBackup = useDeleteBackup()

  // Finding 7(b): the old handler minted a download ticket (HttpOnly cookie)
  // and then navigated the tab to /admin/backup-download/:id with a bare
  // anchor (no `download` attribute). A ticket cookie that never attached —
  // or any error from that navigation — is invisible to JS, so the click
  // silently did nothing (and on failure could navigate the SPA away to a
  // bare error page). Download through the authenticated apiClient instead:
  // the same endpoint, with the auth header the SPA already has, as a blob
  // — the pattern the other admin/pos exports already use. The `download`
  // attribute keeps the SPA on the page, and failures surface as toasts.
  // (Blob buffering is the trade-off vs the ticket's streaming; backups
  // observed here are sub-MB DB dumps, and the endpoint caps nothing — the
  // ticket endpoint stays available server-side for a future streaming path.)
  const handleDownload = useCallback(async (id: string) => {
    try {
      const res = await backupApi.download(id)
      const rawDisposition = res.headers?.['content-disposition']
      const disposition = Array.isArray(rawDisposition)
        ? rawDisposition[0]
        : rawDisposition
      const filename =
        disposition?.match(/filename="?([^";]+)"?/)?.[1] ??
        `backup-${id}.sql.gz`
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err: any) {
      // Error bodies come back as blobs under responseType 'blob', so only
      // surface the message when it is actually a string.
      const message =
        typeof err?.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Download failed'
      toast.error(message)
    }
  }, [])

  const handleRestore = useCallback((id: string) => {
    restore.mutate(id, {
      onSuccess: () => toast.success('Restore started'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Restore failed'),
    })
  }, [restore])

  const handleToggleLock = useCallback((id: string, locked: boolean) => {
    toggleLock.mutate({ id, locked })
  }, [toggleLock])

  const handleDelete = useCallback((id: string) => {
    if (window.confirm('Delete this backup permanently?')) {
      deleteBackup.mutate(id, {
        onSuccess: () => toast.success('Backup deleted'),
      })
    }
  }, [deleteBackup])

  const handleUploadBackup = useCallback((file: File) => {
    uploadBackup.mutate(file, {
      onSuccess: () => toast.success('Backup uploaded'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Upload failed'),
    })
  }, [uploadBackup])

  const handleRunBackup = useCallback((scope: 'db_only' | 'db_files') => {
    setCreatedBackupId(null)
    trigger.mutate(scope, {
      onSuccess: (data) => {
        toast.success('Backup started')
        // Finding 7(a): surface the new backup's id at creation time — it is
        // the id Reconciliation → Apply repairs asks for.
        setCreatedBackupId(data?.id ?? null)
      },
      onError: (err: any) => toast.error(err.response?.data?.message || 'Backup failed'),
    })
  }, [trigger])

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Backup & Restore</h1>
        <div className="flex flex-wrap gap-2">
          <UploadRestoreDialog onUpload={handleUploadBackup} isPending={uploadBackup.isPending} />
          <RunBackupDialog
            onRun={handleRunBackup}
            isPending={trigger.isPending}
            createdBackupId={createdBackupId}
            onClearCreatedId={() => setCreatedBackupId(null)}
          />
        </div>
      </div>

      <BackupStats backups={data?.items} isLoading={isLoading} />

      <BackupTable
        backups={data?.items || []}
        isLoading={isLoading}
        totalPages={data?.totalPages || 1}
        page={page}
        onPageChange={setPage}
        onDownload={handleDownload}
        onRestore={handleRestore}
        restorePending={restore.isPending}
        onToggleLock={handleToggleLock}
        onDelete={handleDelete}
      />
    </div>
  )
}
