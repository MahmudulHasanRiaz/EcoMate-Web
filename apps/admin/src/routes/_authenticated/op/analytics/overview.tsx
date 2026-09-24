import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/analytics/overview')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/analytics' })
  },
})
