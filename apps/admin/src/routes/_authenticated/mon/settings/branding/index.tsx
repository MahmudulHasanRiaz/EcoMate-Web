import { createFileRoute } from '@tanstack/react-router'
import { BrandingSettings } from '@/features/settings/branding-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/branding/')({
  component: BrandingSettings,
})
