import { createFileRoute } from '@tanstack/react-router'
import { ImportOrders } from '@/features/import-orders'

export const Route = createFileRoute('/_authenticated/op/import-orders/')({
  component: ImportOrders,
})
