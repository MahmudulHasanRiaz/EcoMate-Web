import { createFileRoute } from '@tanstack/react-router'
import { Transfers } from '@/features/inventory/transfers'

export const Route = createFileRoute('/_authenticated/op/inventory/transfers')({
  component: Transfers,
})
