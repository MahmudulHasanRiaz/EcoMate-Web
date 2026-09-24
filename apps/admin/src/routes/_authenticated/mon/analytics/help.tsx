import { createFileRoute } from '@tanstack/react-router'
import AnalyticsHelp from '@/features/business-analytics/help'

export const Route = createFileRoute('/_authenticated/mon/analytics/help')({
  component: AnalyticsHelp,
})
