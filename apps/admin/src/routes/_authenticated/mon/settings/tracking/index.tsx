import { createFileRoute } from '@tanstack/react-router'
import { TrackingSettings } from '@/features/settings/tracking'
export const Route = createFileRoute('/_authenticated/mon/settings/tracking/')({ component: TrackingSettings })
