import { createFileRoute } from '@tanstack/react-router'
import SalesAnalytics from '@/features/business-analytics/sales'

export const Route = createFileRoute('/_authenticated/mon/analytics/sales')({
  component: SalesAnalytics,
})
