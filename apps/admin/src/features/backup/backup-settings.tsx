import { useBackupSettings, useUpdateSettings } from './hooks'
import { BackupSettingsForm } from './components/BackupSettingsForm'
import { toast } from 'sonner'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

export function BackupSettingsPage() {
  const { data: settings, isLoading } = useBackupSettings()
  const update = useUpdateSettings()

  const handleSave = (data: Record<string, string>) => {
    update.mutate(data, {
      onSuccess: () => toast.success('Settings saved'),
      onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to save settings'),
    })
  }

  return (
    <>
      <Header title="Backup Settings" />
      <Main>
        <BackupSettingsForm
          settings={settings}
          onSave={handleSave}
          isPending={update.isPending}
        />
      </Main>
    </>
  )
}