import { createFileRoute } from '@tanstack/react-router'
import { BackupSettingsPage } from '@/features/backup/backup-settings'

export const Route = createFileRoute('/_authenticated/mon/backup/settings')({
  component: BackupSettingsPage,
})