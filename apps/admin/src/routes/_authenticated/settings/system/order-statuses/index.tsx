import { createFileRoute } from '@tanstack/react-router'
import { OrderStatusSettings } from '@/features/order-statuses'

export const Route = createFileRoute('/_authenticated/settings/system/order-statuses/')({ component: OrderStatusSettings })
