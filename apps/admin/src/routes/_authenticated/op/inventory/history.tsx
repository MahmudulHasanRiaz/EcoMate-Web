import { createFileRoute } from '@tanstack/react-router'
import { MovementHistory } from '@/features/inventory/history'

export const Route = createFileRoute('/_authenticated/op/inventory/history')({
  component: MovementHistory,
})
