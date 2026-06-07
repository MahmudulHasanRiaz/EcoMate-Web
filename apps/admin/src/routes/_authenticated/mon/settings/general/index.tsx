import { createFileRoute } from '@tanstack/react-router'
import { GeneralSettings } from '@/features/settings/general'

export const Route = createFileRoute('/_authenticated/mon/settings/general/')({
  component: GeneralSettings,
})
