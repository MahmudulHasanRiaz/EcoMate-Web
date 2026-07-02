import { LicenseSettings } from '@/features/settings/license'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/settings/license/')({
  component: LicenseSettings,
})
