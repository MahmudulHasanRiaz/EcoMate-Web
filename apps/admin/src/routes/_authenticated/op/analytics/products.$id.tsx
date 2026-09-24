import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/analytics/products/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/mon/analytics/products/$id', params })
  },
})
