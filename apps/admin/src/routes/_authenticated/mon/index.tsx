import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/overview' })
  },
})
