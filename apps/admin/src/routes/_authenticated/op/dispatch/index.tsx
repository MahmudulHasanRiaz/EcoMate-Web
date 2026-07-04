import { createFileRoute } from '@tanstack/react-router'
import { DispatchPage } from '@/features/dispatch'

export const Route = createFileRoute('/_authenticated/op/dispatch/')({
  component: DispatchPage,
})
