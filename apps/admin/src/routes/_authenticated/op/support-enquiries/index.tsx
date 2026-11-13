import { createFileRoute } from '@tanstack/react-router'
import { SupportEnquiries } from '@/features/support'

export const Route = createFileRoute('/_authenticated/op/support-enquiries/')({
  component: SupportEnquiries,
})
