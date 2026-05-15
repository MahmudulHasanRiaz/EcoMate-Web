import { createFileRoute } from '@tanstack/react-router'
import { CourierSettings } from '@/features/courier-settings'

export const Route = createFileRoute('/_authenticated/mon/settings/system/courier/')({ component: CourierSettings })
