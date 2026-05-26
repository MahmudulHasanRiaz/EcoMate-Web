import { createFileRoute } from '@tanstack/react-router'
import { UserDetail } from '@/features/users/components/user-detail'

export const Route = createFileRoute('/_authenticated/mon/users/$id')({
  component: RouteComponent,
})

function RouteComponent() {
  const { id } = Route.useParams() as { id: string }
  return <UserDetail userId={id} />
}
