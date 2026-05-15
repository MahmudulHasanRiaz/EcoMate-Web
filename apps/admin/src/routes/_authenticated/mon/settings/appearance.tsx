import { createFileRoute } from '@tanstack/react-router'
import { SettingsAppearance } from '@/features/settings/appearance'

export const Route = createFileRoute('/_authenticated/mon/settings/appearance')({
  component: SettingsAppearance,
})
