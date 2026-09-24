import { createFileRoute } from '@tanstack/react-router'
import CustomerAnalytics from '@/features/business-analytics/customers'

export const Route = createFileRoute('/_authenticated/mon/analytics/customers')({
  component: CustomerAnalytics,
})
