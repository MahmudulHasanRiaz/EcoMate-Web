import { createFileRoute } from '@tanstack/react-router'
import { TrackingMonitoring } from '@/features/settings/tracking'

export const Route = createFileRoute('/_authenticated/mon/settings/tracking/monitoring')({
  component: TrackingMonitoring,
})
