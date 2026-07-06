import { createFileRoute } from '@tanstack/react-router'
import AuthSettingsPage from '@/features/auth-settings'

export const Route = createFileRoute('/_authenticated/op/settings/auth/')({
  component: AuthSettingsPage,
})
