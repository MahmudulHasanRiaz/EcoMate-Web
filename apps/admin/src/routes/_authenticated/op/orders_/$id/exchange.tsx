import { createFileRoute } from '@tanstack/react-router'
import { CreateExchangeOrder } from '@/features/orders/exchange'

export const Route = createFileRoute('/_authenticated/op/orders_/$id/exchange')({
  component: CreateExchangeOrder,
})