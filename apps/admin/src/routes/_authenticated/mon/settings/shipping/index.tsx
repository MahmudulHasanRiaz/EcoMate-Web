import { createFileRoute } from '@tanstack/react-router'
import { ShippingSettings } from '@/features/settings/shipping'

export const Route = createFileRoute('/_authenticated/mon/settings/shipping/')({
  component: ShippingSettings,
})
