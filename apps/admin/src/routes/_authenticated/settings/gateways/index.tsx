import { createFileRoute } from '@tanstack/react-router'
import { GatewaySettings } from '@/features/gateways'

export const Route = createFileRoute('/_authenticated/settings/gateways/')({
  component: GatewaySettings,
})
