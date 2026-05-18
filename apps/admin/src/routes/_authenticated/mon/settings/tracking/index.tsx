import { createFileRoute } from '@tanstack/react-router'
import { TrackingSettings } from '@/features/settings/tracking-settings'
export const Route = createFileRoute('/_authenticated/mon/settings/tracking/')({ component: TrackingSettings })
