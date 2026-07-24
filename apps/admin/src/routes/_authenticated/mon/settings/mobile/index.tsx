import { createFileRoute } from '@tanstack/react-router'
import { MobileSettings } from '@/features/settings/mobile/mobile-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/mobile/')({
  component: MobileSettings,
})
