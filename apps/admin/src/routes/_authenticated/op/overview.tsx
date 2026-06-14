import { createFileRoute } from '@tanstack/react-router'
import { DashboardWrapper } from '@/features/dashboard'

export const Route = createFileRoute('/_authenticated/op/overview')({
  component: () => <DashboardWrapper route="op" />,
})
