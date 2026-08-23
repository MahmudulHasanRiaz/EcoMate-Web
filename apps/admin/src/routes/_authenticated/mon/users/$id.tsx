import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/users/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/hr/users/$id', params })
  },
})