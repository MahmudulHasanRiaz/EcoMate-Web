import { createFileRoute } from '@tanstack/react-router'
import { OrderStatusSettings } from '@/features/order-statuses'

export const Route = createFileRoute('/_authenticated/settings/order-statuses/')({
  component: OrderStatusSettings,
})
