import { createFileRoute } from '@tanstack/react-router'
import BusinessOverview from '@/features/business-analytics'

export const Route = createFileRoute('/_authenticated/op/analytics/overview')({
  component: BusinessOverview,
})
