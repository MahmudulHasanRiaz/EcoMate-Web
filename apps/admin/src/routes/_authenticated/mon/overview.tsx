import { createFileRoute } from '@tanstack/react-router'
import { DashboardWrapper } from '@/features/dashboard'

export const Route = createFileRoute('/_authenticated/mon/overview')({
  component: () => <DashboardWrapper route="mon" />,
})
