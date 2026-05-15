import { createFileRoute } from '@tanstack/react-router'
import { SystemSettings } from '@/features/settings/system-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/system/')({
  component: SystemSettings,
})
