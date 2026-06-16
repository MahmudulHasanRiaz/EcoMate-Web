import { createFileRoute } from '@tanstack/react-router'
import { CustomerDetailPage } from '@/features/customers/customer-detail'

export const Route = createFileRoute('/_authenticated/op/customers/$id')({
  component: RouteComponent,
})

function RouteComponent() {
  const { id } = Route.useParams() as { id: string }
  return <CustomerDetailPage customerId={id} />
}
