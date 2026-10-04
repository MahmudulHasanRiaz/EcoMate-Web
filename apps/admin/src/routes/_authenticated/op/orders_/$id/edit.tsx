import { createFileRoute } from '@tanstack/react-router'
import { EditOrder } from '@/features/orders/edit'

export const Route = createFileRoute('/_authenticated/op/orders_/$id/edit')({
  component: EditOrder,
})