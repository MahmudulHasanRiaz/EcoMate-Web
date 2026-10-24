import { createFileRoute } from '@tanstack/react-router'
import { UserDetail } from '@/features/users/components/user-detail'

// Owner 2026-10-24 (Q7): user detail lives with the user list at /mon/users.
export const Route = createFileRoute('/_authenticated/mon/users/$id')({
  component: RouteComponent,
})

function RouteComponent() {
  const { id } = Route.useParams() as { id: string }
  return <UserDetail userId={id} />
}
