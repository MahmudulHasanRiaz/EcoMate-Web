import { createFileRoute } from '@tanstack/react-router'
import CustomerAnalytics from '@/features/business-analytics/customers'

export const Route = createFileRoute('/_authenticated/op/analytics/customers')({
  component: CustomerAnalytics,
})
