import { createFileRoute } from '@tanstack/react-router'
import InventoryAnalytics from '@/features/business-analytics/inventory'

export const Route = createFileRoute('/_authenticated/op/analytics/inventory')({
  component: InventoryAnalytics,
})
