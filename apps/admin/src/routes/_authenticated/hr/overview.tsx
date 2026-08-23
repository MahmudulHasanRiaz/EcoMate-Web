import { createFileRoute } from '@tanstack/react-router'
import { HrDashboard } from '@/features/hr-dashboard'

export const Route = createFileRoute('/_authenticated/hr/overview')({
  component: HrDashboard,
})