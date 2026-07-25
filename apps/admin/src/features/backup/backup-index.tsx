import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useBackups, useTriggerBackup, useRestoreBackup,
  useUploadBackup, useToggleLock, useDeleteBackup } from './hooks'
import { BackupTable } from './components/BackupTable'
import { BackupStats } from './components/BackupStats'
import { RunBackupDialog } from './components/RunBackupDialog'
import { UploadRestoreDialog } from './components/UploadRestoreDialog'
import { apiClient } from '@/lib/api-client'

export function BackupPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useBackups({ page, limit: 20 })
  const trigger = useTriggerBackup()
  const restore = useRestoreBackup()
  const uploadBackup = useUploadBackup()
  const toggleLock = useToggleLock()
  const deleteBackup = useDeleteBackup()

  const handleDownload = useCallback(async (id: string) => {
    try {
      const response = await apiClient.get(`/admin/backup/${id}/download`, {
        responseType: 'blob',
      })
      const disposition = response.headers['content-disposition'] || ''
      const match = disposition.match(/filename="?(.+?)"?$/)
      const filename = match?.[1] || `backup-${id}.sql.gz`
      const url = URL.createObjectURL(new Blob([response.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
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
    trigger.mutate(scope, {
      onSuccess: () => toast.success('Backup started'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Backup failed'),
    })
  }, [trigger])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Backup & Restore</h1>
        <div className="flex gap-2">
          <UploadRestoreDialog onUpload={handleUploadBackup} isPending={uploadBackup.isPending} />
          <RunBackupDialog onRun={handleRunBackup} isPending={trigger.isPending} />
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
        onToggleLock={handleToggleLock}
        onDelete={handleDelete}
      />
    </div>
  )
}