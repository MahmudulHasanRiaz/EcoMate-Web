import { createFileRoute } from '@tanstack/react-router'
import { AvailabilityRules } from '@/features/channels/availability-rules'

export const Route = createFileRoute('/_authenticated/mon/settings/store-availability/')({
  component: AvailabilityRules,
})
