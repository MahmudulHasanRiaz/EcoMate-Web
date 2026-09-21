import { createFileRoute } from '@tanstack/react-router'
import SalesAnalytics from '@/features/business-analytics/sales'

export const Route = createFileRoute('/_authenticated/op/analytics/sales')({
  component: SalesAnalytics,
})
