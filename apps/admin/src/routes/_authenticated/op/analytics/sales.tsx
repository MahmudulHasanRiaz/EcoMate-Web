import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/analytics/sales')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/analytics/sales' })
  },
})
