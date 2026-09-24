import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/analytics/customers')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/analytics/customers' })
  },
})
