import { createFileRoute } from '@tanstack/react-router'
import { BackupPage } from '@/features/backup/backup-index'

export const Route = createFileRoute('/_authenticated/mon/backup/')({
  component: BackupPage,
})