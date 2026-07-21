import { createFileRoute } from '@tanstack/react-router'
import { SecurityDashboardPage } from '@/features/security/components/SecurityDashboardPage'

export const Route = createFileRoute('/_authenticated/mon/security/')({
  component: SecurityDashboardPage,
})
