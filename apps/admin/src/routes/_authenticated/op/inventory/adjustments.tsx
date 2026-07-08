import { createFileRoute } from '@tanstack/react-router'
import { Adjustments } from '@/features/inventory/adjustments'

export const Route = createFileRoute('/_authenticated/op/inventory/adjustments')({
  component: Adjustments,
})
