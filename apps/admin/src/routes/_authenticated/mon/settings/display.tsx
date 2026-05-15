import { createFileRoute } from '@tanstack/react-router'
import { SettingsDisplay } from '@/features/settings/display'

export const Route = createFileRoute('/_authenticated/mon/settings/display')({
  component: SettingsDisplay,
})
