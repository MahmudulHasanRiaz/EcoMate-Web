import { createFileRoute } from '@tanstack/react-router'
import { LeavePage } from '@/features/hr-leave'

export const Route = createFileRoute('/_authenticated/hr/leave')({
  component: LeavePage,
})
