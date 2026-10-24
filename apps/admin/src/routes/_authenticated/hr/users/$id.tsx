import { createFileRoute, redirect } from '@tanstack/react-router'

// Owner 2026-10-24 (Q7): no duplicate user detail in the HR panel — the one
// user detail lives at /mon/users/$id.
export const Route = createFileRoute('/_authenticated/hr/users/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/mon/users/$id', params })
  },
})
