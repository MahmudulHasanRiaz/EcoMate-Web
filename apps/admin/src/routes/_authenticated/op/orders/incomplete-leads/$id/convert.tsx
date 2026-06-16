import { createFileRoute } from '@tanstack/react-router'
import { ConvertLead } from '@/features/orders/convert-lead'

function RouteComponent() {
  const { id } = Route.useParams()
  return <ConvertLead id={id} />
}

export const Route = createFileRoute('/_authenticated/op/orders/incomplete-leads/$id/convert')({
  component: RouteComponent,
})
