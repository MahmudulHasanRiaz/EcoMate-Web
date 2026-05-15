import { createFileRoute } from '@tanstack/react-router'
import { CourierSettings } from '@/features/courier-settings'
export const Route = createFileRoute('/_authenticated/mon/settings/courier/')({ component: CourierSettings })
