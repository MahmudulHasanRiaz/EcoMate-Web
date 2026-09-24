import { createFileRoute } from '@tanstack/react-router'
import MarketingAnalytics from '@/features/business-analytics/marketing'

export const Route = createFileRoute('/_authenticated/mon/analytics/marketing')({
  component: MarketingAnalytics,
})
