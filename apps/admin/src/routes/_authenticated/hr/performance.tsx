import { createFileRoute } from '@tanstack/react-router'
import { HrPerformancePage } from '@/features/hr-performance'

export const Route = createFileRoute('/_authenticated/hr/performance')({
  component: HrPerformancePage,
})
