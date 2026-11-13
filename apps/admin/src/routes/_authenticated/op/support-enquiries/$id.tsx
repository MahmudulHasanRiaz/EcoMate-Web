import { createFileRoute } from '@tanstack/react-router'
import { SupportEnquiryDetail } from '@/features/support/detail'

export const Route = createFileRoute('/_authenticated/op/support-enquiries/$id')({
  component: SupportEnquiryRoute,
})

function SupportEnquiryRoute() {
  const { id } = Route.useParams() as { id: string }
  return <SupportEnquiryDetail id={id} />
}
