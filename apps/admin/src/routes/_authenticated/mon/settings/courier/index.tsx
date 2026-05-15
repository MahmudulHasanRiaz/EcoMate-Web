import { createFileRoute } from '@tanstack/react-router'
import { CourierSettings } from '@/features/settings/courier-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/courier/')({
  component: CourierSettings,
})
