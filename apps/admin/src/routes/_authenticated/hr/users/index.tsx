import { createFileRoute, redirect } from '@tanstack/react-router'

// Owner 2026-10-24 (Q7): no duplicate user list in the HR panel. The one
// user list lives at /mon/users; HR's employee flows link to users from
// there (employee create selects a user) instead of listing them here.
export const Route = createFileRoute('/_authenticated/hr/users/')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/users' })
  },
})
