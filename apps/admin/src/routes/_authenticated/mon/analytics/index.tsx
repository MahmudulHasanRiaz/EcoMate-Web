import { createFileRoute } from '@tanstack/react-router'
import AnalyticsPage from '@/features/analytics'

export const Route = createFileRoute('/_authenticated/mon/analytics/')({
  component: AnalyticsPage,
})
