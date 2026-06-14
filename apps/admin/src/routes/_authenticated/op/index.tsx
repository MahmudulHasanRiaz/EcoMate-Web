import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/op/')({
  beforeLoad: () => {
    throw redirect({ to: '/op/overview' })
  },
})
