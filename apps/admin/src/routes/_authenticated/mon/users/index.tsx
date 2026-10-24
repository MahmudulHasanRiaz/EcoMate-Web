import { createFileRoute } from '@tanstack/react-router'
import { Users } from '@/features/users'

// Owner 2026-10-24 (Q7): the user list lives HERE, in normal User
// Management — not in the HR panel. /hr/users redirects here so there is
// exactly one user list, never a duplicate.
export const Route = createFileRoute('/_authenticated/mon/users/')({ component: Users })
