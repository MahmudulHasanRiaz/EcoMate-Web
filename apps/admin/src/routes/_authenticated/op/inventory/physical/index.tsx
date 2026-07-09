import { createFileRoute } from '@tanstack/react-router'
import { PhysicalStockTable } from '@/features/inventory/physical-stock-table'

export const Route = createFileRoute('/_authenticated/op/inventory/physical/')({
  component: PhysicalStockTable,
})
